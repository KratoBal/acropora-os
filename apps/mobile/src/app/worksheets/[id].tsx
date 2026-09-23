import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { OfflineNoticeCard } from "@/components/offline/OfflineNoticeCard";
import {
  addWorksheetEntry,
  addWorksheetLine,
  getWorksheet,
  listAssignableWorksheetUsers,
  listWorksheetDocuments,
  listWorksheetEntries,
  removeWorksheetLine,
  setWorksheetAssignees,
  uploadWorksheetDocuments,
  closeWorksheet,
  setWorksheetHandedOver,
} from "@/lib/api/worksheets";
import {
  createMaterialRequest,
  listMaterialRequestsForWorksheet,
  submitMaterialRequest,
  type MaterialRequestItemInput,
} from "@/lib/api/material-requests";
import { ApiError, ApiNetworkError } from "@/lib/api/client";
import { describeUploadFailure } from "@/lib/api/network-failure";
import { useIsOnline } from "@/lib/offline/connectivity";
import { describeCachedWorksheetNotice } from "@/lib/offline/offline-notice";
import {
  enqueuePhoto,
  enqueueWorksheetLine,
  queuedWorksheetLineCount,
} from "@/lib/offline/queue-store";
import { ownerPhotoOperationId } from "@/lib/offline/queue-order";
import {
  describePhotoSend,
  uploadOrQueuePhotos,
} from "@/lib/offline/photo-upload-or-queue";
import { saveOrQueue } from "@/lib/offline/save-or-queue";
import {
  readCachedWorksheet,
  rememberWorksheet,
} from "@/lib/offline/worksheet-cache";
import {
  buildWorksheetEntry,
  describeEmptyEntries,
  worksheetEntryByline,
} from "@/lib/worksheets/worksheet-entry";
import {
  buildMaterialRequestItems,
  describeEmptyMaterialRequests,
  materialRequestByline,
  MATERIAL_REQUEST_STATUS_LABEL,
} from "@/lib/worksheets/material-request-presentation";
import { usePhotoAttachments } from "@/lib/photos/use-photo-attachments";
import {
  describeIssuedSheet,
  splitIssuedSheet,
} from "@/lib/worksheets/worksheet-issued-sheet";
import {
  describeDocuments,
  describeUnviewableDocument,
  formatDocumentSize,
  isViewableImage,
} from "@/lib/documents/document-view";
import { DocumentImage } from "@/components/documents/DocumentImage";
import { munkaoraEgysegFigyelmeztetes } from "@/lib/worksheets/munkaora-egyseg";
import { WORKSHEET_PHOTO_NOTICE } from "@/lib/worksheets/worksheet-photo";
import {
  describeAssignableUsers,
  describeAssigneeReadOnly,
  toggleWorksheetAssignee,
  worksheetAssigneesChanged,
} from "@/lib/worksheets/worksheet-assignees";
import {
  buildWorksheetLinePayload,
  describeQueuedWorksheetLines,
  describeWorksheetLineQueueWrite,
  worksheetLineId,
} from "@/lib/worksheets/worksheet-line";
import { canSignWorksheetVersion } from "@/lib/worksheets/worksheet-signature";
import {
  canCloseWorksheetVersion,
  lezarasHibaUzenete,
  LEZARAS_TERERO_NELKUL,
} from "@/lib/worksheets/worksheet-close";
import {
  atadasHibaUzenete,
  ATADAS_TERERO_NELKUL,
  canMarkWorksheetHandover,
  handoverGombFelirata,
  handoverKuldendoErtek,
} from "@/lib/worksheets/worksheet-handover";
import {
  kikuldesAllapotSora,
  kikuldhetoAlairasra,
} from "@/lib/worksheets/worksheet-send-for-signature";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getServiceCapabilities } from "@/lib/auth/webshop-authorization";
import {
  formatWorksheetDate,
  worksheetAssigneeLine,
  worksheetDetailRows,
  worksheetLabelOrDraft,
  worksheetLineSummary,
  worksheetStatusLabel,
} from "@/lib/worksheets/worksheet-presentation";

/**
 * MUNKALAP A HELYSZÍNEN.
 *
 * Itt korábban az állt, hogy a képernyőn nincs szerkesztés, mert egy félig
 * megírt lapot csak a webes felület tudna befejezni. Ez a mondat MA MÁR NEM
 * IGAZ, és nem kiegészítettem, hanem átírtam: a tételek rögzítése és az
 * ALÁÍRÁS is innen megy (Balázs döntése, 2026-09-03).
 *
 * A LEZÁRÁS 2026-09-18 ÓTA SZINTÉN ITT VAN, és ezt a mondatot ÁTÍRTAM, nem
 * kiegészítettem: korábban az állt, hogy a lezárás az irodáé. Balázs döntése
 * hozta át ("igen, zárhassa le a helyszínen"), és nem önmagáért: a lezárás az
 * aláírás ELŐFELTÉTELE (aláírni csak aláírásra váró lapot lehet), tehát enélkül
 * a szerelő a helyszínen nem jutott el az aláírásig.
 *
 * Ami továbbra sem itt van: az ÁR és a folytatás. Azok az irodáé, és ezt a
 * mai döntés sem tágította.
 *
 * AMI A LAP MAI ÁLLAPOTA, az a `currentVersion`. A korábbi változatok
 * változatlanok, és külön szakaszban látszanak: aki a kezében tartott papírral
 * érkezik, itt tudja eldönteni, hogy azóta átírták-e a lapot.
 */
export default function WorksheetDetailScreen() {
  /**
   * A TETEL-FELVITEL ALLAPOTA. Harom mezo, mert a szerelo harmat rogzit: mit
   * csinalt, mennyit, milyen egysegben. Az ARAT az iroda adja meg.
   */
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("óra");
  /*
    A FAJTA ES A LETSZAM MENTES UTAN NEM ALL VISSZA -- ugyanaz a dontes, mint az
    EGYSEGNEL (az sem urul ki). A szerelo egymas utan tobb tetelt ir be
    ugyanarrol a munkarol, es ha minden sor utan ujra be kellene allitania, hogy
    munkaora es hanyan voltak, akkor a harmadik tetelnel elfelejti.

    AZ ALAPERTELMEZES MUNKAORA. Nem az egyseg szovegebol vezetjuk le (az szabad
    szoveg, es egy elgepelt "ora" csendben kimaradna), hanem abbol, hogy a
    telefonon a szerelo tulnyomoreszt munkat rogzit -- ugyanaz a meres, amibol
    az egyseg alapertelmezese "óra" lett.
  */
  const [isLabor, setIsLabor] = useState(true);
  /*
    A SOR ELLENTMONDASA. A szabaly sajat modulban all, mert ott MERHETO -- es
    azert van kulon peldanya a webestol, mert ez a csomag nem tud a
    `@acropora/types`-bol importalni (kivul esik a pnpm munkateren).
  */
  const [workerCount, setWorkerCount] = useState("1");
  const [lineError, setLineError] = useState<string | null>(null);
  /**
   * A SORBA KERULT TETEL UZENETE, KULON A HIBATOL. Nem hiba: a felvitel
   * megtortent, csak meg a telefonon var. Ugyanabban a piros dobozban a
   * szerelo elveszettnek hinne, es ujra beirna -- es akkor ketszer kerulne fel.
   */
  const [queued, setQueued] = useState<string | null>(null);
  /**
   * A BEJEGYZES URLAPJA. `null`, amig a szerelo ra nem koppint a gombra --
   * Balazs kerese szerint a mezo NEM all ott mindig, hanem a "Bejegyzes"
   * gombra nyilik ki.
   */
  const [entryDraft, setEntryDraft] = useState<string | null>(null);
  const [entryError, setEntryError] = useState<string | null>(null);

  /**
   * AZ ANYAGIGENYLES URLAPJA. Ugyanaz az alak, mint a bejegyzesnel: `false`,
   * amig a szerelo ra nem koppint az "Anyagigénylés" gombra. A sorok NEM
   * `useMutation`-be zart allapot, mert a felvitel HELYI: a szerverre csak a
   * "Küldés" gomb kuldi el (lasd a webes `WorksheetMaterialRequests`
   * fejleceit -- ugyanaz a minta).
   */
  const [materialRequestFormOpen, setMaterialRequestFormOpen] = useState(false);
  const [materialRequestRows, setMaterialRequestRows] = useState<
    MaterialRequestItemInput[]
  >([{ name: "", quantity: "", unit: "" }]);
  const [materialRequestError, setMaterialRequestError] = useState<
    string | null
  >(null);
  /**
   * A `submit()` VALASZANAK `warning` MEZOJE -- KULON A HIBATOL, ugyanaz az
   * ok, mint a webes felulet parjaban: a kuldes SIKERES volt, csak arrol
   * szol, hogy ma senki nem tudja jelolni a beerkezest.
   */
  const [materialRequestNotice, setMaterialRequestNotice] = useState<
    string | null
  >(null);

  /**
   * A FELELOS-SZERKESZTO ALLAPOTA.
   *
   * `null`, amig a szerelo ra nem koppint a gombra -- ugyanaz az alak, mint a
   * bejegyzes urlapjanal. NEM ures tomb: az nem kulonboztetne meg a "meg ki
   * sem nyitottam" allapotot attol, hogy "kinyitottam es MINDENKIT levettem".
   * A masodikbol valodi mentes lesz (a lap felelos nelkul marad), az elsobol
   * semmi -- es a ket allapot kozott epp ez a kulonbseg.
   */
  const [assigneeDraft, setAssigneeDraft] = useState<string[] | null>(null);
  const [assigneeError, setAssigneeError] = useState<string | null>(null);
  const [assigneeSaving, setAssigneeSaving] = useState(false);

  /**
   * A FENYKEP ALLAPOTA.
   *
   * A VALASZTO FELE A KOZOS HOROG (`lib/photos/use-photo-attachments.ts`):
   * engedelykeres, valaszto, a mar kivalasztott kep kiszurese, es a
   * formatum miatt kimaradt fajlok kimondasa. Nem irom ujra -- ez a kod
   * 2026-09-16 ota EGY helyen all, harom kepernyo hasznalja.
   *
   * AMI VISZONT MAS ITT, MINT A HAROM HIVONAL: azok UJ FELVITELI urlapok,
   * ahol a rekord MEG NEM LETEZIK, tehat gyujtik a kepeket, es a sorsuk a
   * mentes utan dol el. Ez a lap MAR LETEZIK, es van azonositoja: a kep
   * AZONNAL felmehet, sajat gombbal.
   *
   * MIERT KULON "Feltoltes" GOMB, ES NEM AZONNALI KULDES A VALASZTAS UTAN
   * (ahogy a hibajegy reszletlapja csinalja): a horog nem ad visszahivast, csak
   * allapotot gyujt, tehat az azonnali kuldeshez egy `photos`-ra allo
   * mellekhatas kellene. Az a BUKASNAL romlik el: egy sikertelen feltoltes utan
   * a kepek bent maradnak, es a kovetkezo valasztas MEGINT elkuldene oket -- a
   * lapra ket peldany kerulne ugyanabbol a kepbol. Igy a bukas utan a kepek
   * egyszeruen ott allnak, es a gomb ujra megnyomhato.
   *
   * A KET KEPERNYO IGY ELTER EGYMASTOL, es ez KIMONDVA all, nem elnezes. Az
   * egysegesites kulon kartya: ahhoz a hibajegy lapjahoz kellene hozzanyulni.
   */
  const [uploading, setUploading] = useState(false);
  const [photoNotice, setPhotoNotice] = useState<string | null>(null);
  const {
    photos,
    notice: photoPickNotice,
    clear: clearPhotos,
    takePhoto,
    pickPhotos,
  } = usePhotoAttachments();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { status, user } = useAuth();
  const capabilities = user ? getServiceCapabilities(user.role) : null;

  const online = useIsOnline();

  /**
   * A LAP A MUNKAUTASITAS: TERERŐ NELKUL IS OLVASHATONAK KELL LENNIE.
   *
   * A sikeres lekerdezes MENT is: ami a kepernyore kerult, az a keszuleken
   * marad. Nem elore toltunk le semmit -- csak azt, amit a szerelo tenylegesen
   * megnyitott.
   */
  const worksheet = useQuery({
    queryKey: ["worksheet", id],
    queryFn: async () => {
      const detail = await getWorksheet(id);
      await rememberWorksheet(detail);
      return detail;
    },
    enabled: Boolean(
      id && capabilities?.worksheetsView && status === "authenticated",
    ),
  });

  const cached = useQuery({
    queryKey: ["worksheet-cache", id],
    queryFn: () => readCachedWorksheet(id),
    enabled: Boolean(id && status === "authenticated"),
  });

  /**
   * HANY TETEL VAR MEG FELTOLTESRE EHHEZ A LAPHOZ.
   *
   * A sorba tett tetel a lenti listan NEM jelenik meg: az a szerver valaszabol
   * jon. A mentes utani mondat ezt kimondja, de csak EGY kepernyo-eletre: aki
   * visszalep es ujra megnyitja a lapot, semmit nem latna belole -- es ujra
   * beirna ugyanazt a tetelt.
   */
  /**
   * A MUNKANAPLO. Kulon lekerdezes, nem a lap reszekent: a bejegyzesek a
   * laptol FUGGETLENUL valtoznak (barki irhat rajuk), es egy kozos
   * lekerdezesben minden bejegyzes-mentes ujrahuzna a teljes lapot is.
   */
  const entries = useQuery({
    queryKey: ["worksheet-entries", id],
    queryFn: () => listWorksheetEntries(id),
    enabled: Boolean(
      id && capabilities?.worksheetsView && status === "authenticated",
    ),
  });

  /**
   * AZ ANYAGIGENYEK. Kulon lekerdezes, ugyanabbol az okbol, mint a
   * munkanaplo: a lista a laptol FUGGETLENUL valtozik (a beszerzo is irhat
   * ra), es egy kozos lekerdezesben minden anyagigeny-mentes ujrahuzna a
   * teljes lapot is.
   */
  const materialRequests = useQuery({
    queryKey: ["worksheet-material-requests", id],
    queryFn: () => listMaterialRequestsForWorksheet(id),
    enabled: Boolean(
      id && capabilities?.worksheetsView && status === "authenticated",
    ),
  });

  const queuedLines = useQuery({
    queryKey: ["worksheet-queued-lines", id],
    queryFn: () => queuedWorksheetLineCount(id),
    enabled: Boolean(id && status === "authenticated"),
  });

  /**
   * A HOROK A KORAI VISSZATERESEK ELOTT ALLNAK, es ez nem stilus: a React
   * szabalya szerint minden renderelesben UGYANABBAN a sorrendben kell
   * lefutniuk. Egy `Redirect` utan elhelyezve az elso jogosultsag-valtasnal
   * borulna a sorrend, es a hiba nem itt jelenne meg.
   */
  const queryClient = useQueryClient();

  /**
   * A LEZARAS ALLAPOTA. Kulon a tobbi hibatol: a szerelo itt egy MONDATOT var,
   * ami megmondja, mit tegyen (tetelt vesz fel, vagy varjon tererore).
   */
  const [lezarasHiba, setLezarasHiba] = useState<string | null>(null);

  /**
   * A LEZARAS NEM MEGY SORBA, ES EZ MERESEN ALL -- az indok a
   * `worksheet-close.ts` fejleceben. Roviden: a lezaras OSZTJA a
   * munkalapszamot (szerver-oldali sorozatbol), es utana AZONNAL alairas
   * kovetkezik. Egy sorban allo lezaras mellett a lap a telefonon piszkozat
   * maradna, tehat az alairas gombja meg sem jelenne -- a szerelo egy
   * "sikeres" lezaras utan allna ott, tovabblepes nelkul.
   */
  const lezaras = useMutation({
    mutationFn: () => closeWorksheet(id),
    onSuccess: async () => {
      setLezarasHiba(null);
      await queryClient.invalidateQueries({ queryKey: ["worksheet", id] });
    },
    onError: (cause) =>
      setLezarasHiba(
        cause instanceof ApiNetworkError
          ? LEZARAS_TERERO_NELKUL
          : lezarasHibaUzenete(
              cause instanceof ApiError ? cause.message : null,
            ),
      ),
  });

  /**
   * AZ ATADAS JELOLESE A HELYSZINEN.
   *
   * Balazs dontese, 2026-09-21: a szerelo jeloli meg, amikor visszaadja a
   * gepet. KULON LEPES, nem a lezaras melleke -- a reszletes indok a
   * `worksheet-handover.ts` fejleceben all.
   *
   * TERERO NELKUL MEGTAGADVA, NEM SORBA TEVE, es ennek is ott all az indoka:
   * a sorba tett valtozat a telefonon mar atadottnak mutatna a lapot, kozben
   * a szerver -- es a ra epulo lezarasi kapu -- meg nem tudna rola.
   */
  const [atadasHiba, setAtadasHiba] = useState<string | null>(null);
  const atadas = useMutation({
    mutationFn: (handedOver: boolean) => setWorksheetHandedOver(id, handedOver),
    onSuccess: async () => {
      setAtadasHiba(null);
      await queryClient.invalidateQueries({ queryKey: ["worksheet", id] });
    },
    onError: (cause) =>
      setAtadasHiba(
        cause instanceof ApiNetworkError
          ? ATADAS_TERERO_NELKUL
          : atadasHibaUzenete(cause instanceof ApiError ? cause.message : null),
      ),
  });

  /**
   * A LAP CSATOLMANYAI -- ES EZ A SZAKASZ NEM A FELTOLTES PARJA.
   *
   * A MEGNEZES `service.view` alatt all, a FELTOLTES `service.manage` alatt.
   * Ezert a galeria KIVUL all a feltolto szakasz jogosultsagi kapujan: aki a
   * lapot latja, a hozza tartozo kepeket is lathatja. Ha a kapun BELUL allna,
   * a szerelo-nezo epp azt nem latna, amiert a kepek felkerultek.
   */
  const documents = useQuery({
    queryKey: ["worksheet-documents", id],
    queryFn: () => listWorksheetDocuments(id),
    enabled: Boolean(
      id && capabilities?.worksheetsView && status === "authenticated",
    ),
  });

  /**
   * MELYIK KEP VAN EPP NAGYBAN. `null`, amig egyikre sem koppintottak.
   *
   * RATET, NEM `Modal`: ebben az appban ma NULLA `Modal` all (ujramerve
   * 2026-09-17, 235 fajlon), es a `label-code-field.tsx` fejlece kimondja,
   * hogy a `Modal` bevezetese KULON dontes lenne, mind a harom ratettel
   * egyszerre. Nem hozom meg helyettuk.
   */
  const [nagyKep, setNagyKep] = useState<string | null>(null);
  /*
    AZ UTVONAL A KLIENS SAJAT `BASE`-EVEL EGYEZIK, nem a kepernyo mappajaval.
    A bajtokat innentol a `DocumentImage` keri le, a TOKENNEL egyutt, es helyi
    fajlba irja -- a bongeszo `<img>` eleme ott nem letezik, a natív betolto
    pedig Authorization fejlecet NEM kuld.
  */
  const egysegFigyelmeztetes = munkaoraEgysegFigyelmeztetes({
    kind: isLabor ? "LABOR" : "OTHER",
    unit,
  });

  const gazdaUtvonal = id
    ? `/service/worksheets/${encodeURIComponent(id)}`
    : null;

  /**
   * AKIRE A LAP KIOSZTHATO -- CSAK AKKOR TOLT, AMIKOR A SZERKESZTO KINYILIK.
   *
   * Ugyanaz a szabaly, mint a lista-kepernyo partner-valasztojanal: a lap
   * MEGNYITASA ne huzzon le egy listat, amire a legtobb esetben nincs szukseg.
   *
   * ES A JOG IS FELTETEL: a lekerdezes `service.view` alatt all, tehat a
   * szerelonek megvan -- de aki nem irhatja at a kiosztast, annak a LISTA sem
   * kell. A neveket o is latja, azok a lap valaszaban jonnek.
   */
  const assignableUsers = useQuery({
    queryKey: ["worksheet-assignable-users"],
    queryFn: listAssignableWorksheetUsers,
    enabled:
      assigneeDraft !== null &&
      status === "authenticated" &&
      Boolean(capabilities?.worksheetsManage),
  });

  /**
   * A FELELOSOK MENTESE.
   *
   * A TELJES NEVSOR MEGY, NEM A KULONBSEG: a szerver `PUT`-ot vesz, es a
   * bekuldott lista a lap felelőseinek TELJES allapota. Ez azt is jelenti,
   * hogy ha kozben egy masik szerelo szerkesztett, az o valasztasa ELVESZ --
   * ma a weben is igy van, nem a telefon vezeti be.
   *
   * A SZERKESZTO CSAK SIKER UTAN CSUKODIK BE. Egy hiba utan a kivalasztott
   * nevsor az EGYETLEN peldany a kezunkben: eldobni ugyanaz a nema veszteseg,
   * mint elvetni egy beirt tetelt kerdes nelkul.
   */
  const assigneeMutation = useMutation({
    mutationFn: async (userIds: string[]) => {
      if (!id) throw new Error("A munkalap azonosítója hiányzik.");
      return setWorksheetAssignees(id, userIds);
    },
    onMutate: () => {
      setAssigneeError(null);
      setAssigneeSaving(true);
    },
    onSuccess: async () => {
      setAssigneeDraft(null);
      await queryClient.invalidateQueries({ queryKey: ["worksheet", id] });
    },
    onError: (cause) =>
      setAssigneeError(
        cause instanceof Error
          ? cause.message
          : "A felelősök mentése nem sikerült.",
      ),
    onSettled: () => setAssigneeSaving(false),
  });

  /**
   * A KIVALASZTOTT KEPEK FELKULDESE.
   *
   * A MONDATOKAT NEM ITT RAKOM OSSZE, hanem a `worksheet-photo.ts`-ben: ott
   * MERHETO, itt nem. Ebben a csomagban nincs komponens-teszt eszkoz.
   *
   * A KEPEK CSAK SIKER UTAN URULNEK KI. Egy hibanal a kivalasztott kep az
   * EGYETLEN peldany a kezunkben, es eldobni ugyanaz a nema veszteseg, mint
   * elvetni egy beirt tetelt kerdes nelkul.
   */
  const feltolt = async () => {
    if (photos.length === 0 || uploading || !id) return;
    setPhotoNotice(null);
    setUploading(true);
    try {
      /**
       * A DONTES A `lib/offline/photo-upload-or-queue.ts`-BEN ALL, mert ott
       * MERHETO: ebben a csomagban nincs komponens-teszt, es epp ezt a reszt a
       * legdragabb ugy probalni, ahogy a szerelo talalkozik vele -- a
       * pinceben, terero nelkul.
       */
      const eredmeny = await uploadOrQueuePhotos({
        files: photos,
        upload: async (files) => {
          const created = await uploadWorksheetDocuments(id, { files });
          /** A SZERVER SZAMA MEGY TOVABB, nem amit kuldtunk. */
          return { count: created.length };
        },
        enqueue: async (file) => {
          const r = await enqueuePhoto({
            /**
             * A KULCS A TARTALOMBOL SZULETIK: a ketszer megnyomott gomb
             * ugyanazt a sort adja, nem kettot.
             */
            id: ownerPhotoOperationId({
              entityType: "worksheet",
              ownerId: id,
              uri: file.uri,
            }),
            payload: { uri: file.uri, name: file.name, type: file.type },
            createdAt: new Date().toISOString(),
            entityType: "worksheet",
            /**
             * A GAZDA MAR LETEZIK, tehat az azonosito MOST kerul a sorba -- a
             * kep nem var senkire, es nem is varakoztat senkit.
             */
            ownerId: id,
          });
          return r.ok;
        },
        statusOf: (cause) => (cause instanceof ApiError ? cause.status : null),
        describeRejection: (cause) =>
          /**
           * A SZERVER VALASZOLT, tehat az O uzenete a helyes: az megmondja, mi
           * a baj (tul nagy fajl, rossz formatum, nincs jog).
           */
          cause instanceof Error
            ? cause.message
            : "A feltöltés nem sikerült. Próbáld újra.",
      });

      /**
       * A KEPEK CSAK AKKOR URULNEK KI, HA VALAHOL LETEZNEK -- a szerveren vagy
       * a sorban. Egy elutasitasnal a kivalasztott kep az EGYETLEN peldany a
       * kezunkben, es eldobni ugyanaz a nema veszteseg, mint elvetni egy beirt
       * tetelt kerdes nelkul.
       */
      if (eredmeny.type === "uploaded" || eredmeny.type === "queued")
        clearPhotos();

      setPhotoNotice(describePhotoSend(eredmeny, []));

      if (eredmeny.type === "uploaded") {
        await queryClient.invalidateQueries({ queryKey: ["worksheet", id] });
        /**
         * A GALERIA IS FRISSUL, NEM CSAK A LAP. Enelkul a most feltoltott kep
         * NEM jelenne meg a szakaszban -- vagyis a szerelo ugyanazt latna,
         * amit a mai hianynal: feltoltott, es nincs sehol.
         *
         * A SORBA TETT KEPNEL NEM frissitunk: az meg NINCS a szerveren, tehat
         * a lista valtozatlan lenne, es egy folosleges kor menne el ra.
         */
        await queryClient.invalidateQueries({
          queryKey: ["worksheet-documents", id],
        });
      }
    } catch (cause) {
      /**
       * IDE MA CSAK AZ JUT EL, AMI NEM A KULDES BUKASA (a `uploadOrQueuePhotos`
       * a halozati hibat sorba teszi, a valaszolt hibat pedig visszaadja).
       * A jelzes megis ugyanaz, mert ha valaha ide MEGIS halozati hiba kerul,
       * a kepernyo mondja meg, MI panaszol -- ne megint egy nema mondat alljon
       * itt. Lasd `lib/api/network-failure.ts`.
       */
      setPhotoNotice(
        describeUploadFailure({
          error: cause,
          uris: photos.map((f) => f.uri),
          networkFailure: cause instanceof ApiNetworkError,
        }),
      );
    } finally {
      setUploading(false);
    }
  };

  /**
   * TETEL HOZZAADASA -- SOR-SZINTU MUVELET, NEM TELJES CSERE.
   *
   * Egy lapnak TOBB felelose lehet, es a teljes tartalmat cserelo mentes a
   * masik szerelo sorait torolne. A szerver ezt a vegpontot EPP A MOBILNAK
   * keszitette (a kod megjegyzese ki is mondja), es 2026-09-03-ig NEM hivta
   * senki: a kepesseg megvolt, a hivo hianyzott.
   *
   * A DONTES a `lib/worksheets/worksheet-line.ts`-ben all, mert ott MERHETO.
   */
  const addLine = useMutation({
    mutationFn: async () => {
      /**
       * AZ AZONOSITO EGYSZER SZULETIK, ES MIND A KET UTON UGYANAZ.
       *
       * Ugyanez megy a szervernek a tetel `id` mezojekent ES a sor kulcsakent.
       * A szerver erre idempotens: egy megszakadt kuldes ujrakuldese a MEGLEVO
       * tetelt talalja meg, nem masodikat hoz letre. Ha a ket uton ket kulcsot
       * adnank, epp ez a vedelem esne ki.
       */
      const lineId = worksheetLineId({
        now: Date.now(),
        random: Math.random(),
      });
      const built = buildWorksheetLinePayload(
        {
          description,
          quantity,
          unit,
          kind: isLabor ? "LABOR" : "OTHER",
          workerCount,
        },
        lineId,
      );
      if (!built.ok) throw new Error(built.message);
      const { id: _lineId, ...torzs } = built.payload;
      /**
       * MENTES: ELOSZOR A SZERVERNEK, ES CSAK HALOZATI HIBANAL A SORBA.
       *
       * A dontes a `lib/offline/save-or-queue.ts`-ben all, mert ott MERHETO --
       * ebben a fajlban nincs, ami tesztelne. Ugyanaz a fuggveny fut, mint az
       * eszkoz- es a munkalap-felvitelnel; a SZOVEG kulon, mert itt a lap
       * LATSZIK, es a tetel megsem jelenik meg rajta.
       *
       * A szerver valasza (a teljes lap) itt NEM kell: a keperno amugy is
       * ujrakerdezi. Igy a ket ag ugyanazt az alakot adja vissza.
       */
      return saveOrQueue({
        save: async () => {
          await addWorksheetLine(id, built.payload);
          return { id: lineId };
        },
        enqueue: () =>
          enqueueWorksheetLine({
            id: lineId,
            /** A GAZDA lap azonositoja: tetelt csak meglevo lapra lehet felvenni. */
            worksheetId: id,
            payload: torzs,
            createdAt: new Date().toISOString(),
          }),
        statusOf: (cause) => (cause instanceof ApiError ? cause.status : null),
        describeWrite: describeWorksheetLineQueueWrite,
      });
    },
    onSuccess: async (outcome) => {
      if (outcome.type === "rejected" || outcome.type === "lost") {
        setLineError(outcome.message);
        return;
      }
      /**
       * A MEZOK CSAK AKKOR URULNEK KI, HA A TETEL VALAHOL LETEZIK -- a
       * szerveren vagy a sorban. Egy `lost` kimenetnel a felvitel SEHOL nincs
       * meg, es a beirt szoveg az EGYETLEN peldany: azt kitorolni ugyanaz a
       * nema veszteseg, mint elvetni valamit kerdes nelkul.
       */
      setDescription("");
      setQuantity("");
      setLineError(null);
      setQueued(outcome.type === "queued" ? outcome.message : null);
      await queryClient.invalidateQueries({ queryKey: ["worksheet", id] });
      await queryClient.invalidateQueries({
        queryKey: ["worksheet-queued-lines", id],
      });
    },
    onError: (cause) =>
      setLineError(
        cause instanceof Error ? cause.message : "A tétel nem menthető.",
      ),
  });

  /**
   * UJ BEJEGYZES. A SZERZO A BEJELENTKEZETT KOLLEGA, es a telefon nem is kuldi:
   * a szerver a munkamenetbol veszi. Egy kliens-oldali szerzo-mezo azt
   * jelentene, hogy barki barki neveben irhat a naploba.
   */
  const addEntry = useMutation({
    mutationFn: async () => {
      const built = buildWorksheetEntry(entryDraft ?? "");
      if (!built.ok) throw new Error(built.message ?? "A bejegyzés üres.");
      return addWorksheetEntry(id, built.body);
    },
    onSuccess: async () => {
      setEntryDraft(null);
      setEntryError(null);
      await queryClient.invalidateQueries({
        queryKey: ["worksheet-entries", id],
      });
    },
    onError: (cause) =>
      setEntryError(
        cause instanceof Error ? cause.message : "A bejegyzés nem menthető.",
      ),
  });

  /**
   * A FELVITEL ES A KULDES EGY KORBEN -- UGYANAZ A MINTA, MINT A WEBEN
   * (`WorksheetMaterialRequests.sendNew`): a `create` az UJ SORT adja, a
   * `submit` a TELJES listat, es ha a `create` lefutott de a `submit` nem, a
   * piszkozat a szerveren MEGVAN -- ezert a hiba-agban is frissitunk, ne csak
   * hibauzenetet mutassunk egy eltunt allapotra.
   */
  const sendNewMaterialRequest = useMutation({
    mutationFn: async () => {
      const built = buildMaterialRequestItems(materialRequestRows);
      if (!built.ok)
        throw new Error(built.message ?? "Az anyagigény nem küldhető el.");
      const draft = await createMaterialRequest(id, { items: built.items });
      return submitMaterialRequest(draft.id);
    },
    onSuccess: (response) => {
      queryClient.setQueryData(["worksheet-material-requests", id], response);
      setMaterialRequestRows([{ name: "", quantity: "", unit: "" }]);
      setMaterialRequestFormOpen(false);
      setMaterialRequestError(null);
      setMaterialRequestNotice(response.warning ?? null);
    },
    onError: async (cause) => {
      setMaterialRequestError(
        cause instanceof Error
          ? cause.message
          : "Az anyagigény nem küldhető el.",
      );
      await queryClient.invalidateQueries({
        queryKey: ["worksheet-material-requests", id],
      });
    },
  });

  /** A MEGMARADT PISZKOZAT UJRAKULDESE -- lasd a `sendNewMaterialRequest` fejlecet. */
  const sendDraftMaterialRequest = useMutation({
    mutationFn: (requestId: string) => submitMaterialRequest(requestId),
    onSuccess: (response) => {
      queryClient.setQueryData(["worksheet-material-requests", id], response);
      setMaterialRequestError(null);
      setMaterialRequestNotice(response.warning ?? null);
    },
    onError: (cause) =>
      setMaterialRequestError(
        cause instanceof Error
          ? cause.message
          : "Az anyagigény nem küldhető el.",
      ),
  });

  const removeLine = useMutation({
    mutationFn: (lineId: string) => removeWorksheetLine(id, lineId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["worksheet", id] });
    },
    onError: (cause) =>
      setLineError(
        cause instanceof Error ? cause.message : "A tétel nem törölhető.",
      ),
  });

  if (status !== "authenticated" || !user || !capabilities)
    return <Redirect href="/login" />;
  if (!capabilities.worksheetsView) return <Redirect href="/" />;

  /**
   * A MENTETT MASOLAT CSAK AKKOR LEP BE, HA A FRISS NINCS MEG. Egy mukodo
   * lekerdezes melle odatett masolat azt kockaztatna, hogy a regi adat egy
   * pillanatra felulirja az ujat.
   */
  const cachedDetail = cached.data?.detail ?? null;
  const data = worksheet.data ?? cachedDetail;
  const fromCache = !worksheet.data && Boolean(cachedDetail);
  const cacheNotice =
    fromCache && cachedDetail
      ? describeCachedWorksheetNotice({
          online,
          syncedAt: cached.data?.syncedAt ?? null,
          status: cachedDetail.currentVersion.status,
          now: new Date(),
        })
      : null;
  const current = data?.currentVersion;
  const queuedLinesNotice = describeQueuedWorksheetLines(queuedLines.data ?? 0);
  /**
   * A KIADOTT LAP KULON SZAKASZBA KERUL, ES A SZAM SEM SZAMOLJA BELE.
   *
   * Eddig a lezaraskor kiadott hiteles lap a "Csatolmanyok" kozott allt, es a
   * fejlec szama is beleszamolta: HARMAT allitott ott, ahol ketto csatolmany
   * van es egy kiadott lap. A besorolas es a szam volt rossz, nem a hozzaferes.
   */
  const { issued: kiadottLapok, attachments: csatolmanyok } = splitIssuedSheet(
    documents.data?.items ?? [],
  );
  const kepek = csatolmanyok.filter((d) => isViewableImage(d.contentType));
  const egyebek = csatolmanyok.filter((d) => !isViewableImage(d.contentType));
  const csatolmanyNotice = describeDocuments({
    loading: documents.isPending,
    error: documents.isError,
    total: csatolmanyok.length,
    images: kepek.length,
  });
  const readOnlyAssigneeNotice = describeAssigneeReadOnly(
    capabilities.worksheetsManage,
  );
  const assignableNotice =
    assigneeDraft === null
      ? null
      : describeAssignableUsers({
          loading: assignableUsers.isPending,
          error: assignableUsers.isError,
          count: assignableUsers.data?.items.length ?? 0,
        });
  const assigneeChanged =
    assigneeDraft !== null &&
    worksheetAssigneesChanged(
      assigneeDraft,
      (data?.assignees ?? []).map((assignee) => assignee.userId),
    );
  /**
   * A KIKULDES ALLAPOT-SORA, EGYSZER kiszamolva. `null`, amig nem kuldtuk ki.
   */
  const kikuldesSora = current
    ? kikuldesAllapotSora({
        sentForSignatureAt: current.sentForSignatureAt,
        sentForSignatureToName: current.sentForSignatureToName,
      })
    : null;

  /** Az anyagigény-felvitel sorainak szerkesztése -- lásd a web `updateRow`/`addRow`/`removeRow` mintáját. */
  const addMaterialRequestRow = () =>
    setMaterialRequestRows((sorok) => [
      ...sorok,
      { name: "", quantity: "", unit: "" },
    ]);
  const removeMaterialRequestRow = (index: number) =>
    setMaterialRequestRows((sorok) => sorok.filter((_, i) => i !== index));
  const updateMaterialRequestRow = (
    index: number,
    field: keyof MaterialRequestItemInput,
    value: string,
  ) =>
    setMaterialRequestRows((sorok) =>
      sorok.map((sor, i) => (i === index ? { ...sor, [field]: value } : sor)),
    );

  const rows = data ? worksheetDetailRows(data) : [];
  const continuesFrom = data?.continues ?? null;
  const olderVersions = data?.versions.filter(
    (version) => version.version !== current?.version,
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.eyebrow}>MUNKALAP</Text>
        <View style={styles.titleRow}>
          <Text style={styles.title}>
            {worksheetLabelOrDraft(current?.label ?? null)}
          </Text>
          {current ? (
            <View style={styles.statusChip}>
              <Text style={styles.statusText}>
                {worksheetStatusLabel[current.status]}
              </Text>
            </View>
          ) : null}
        </View>

        {cacheNotice ? <OfflineNoticeCard notice={cacheNotice} /> : null}

        {worksheet.isPending && !fromCache ? (
          <ActivityIndicator color="#52d6c7" />
        ) : null}

        {worksheet.isError && !fromCache ? (
          <Text style={styles.error}>
            {worksheet.error instanceof Error
              ? worksheet.error.message
              : "A munkalap nem tölthető be."}
          </Text>
        ) : null}

        {data && current ? (
          <>
            <Text style={styles.subject}>{current.subject}</Text>

            {/*
              KINEK KULDTUK EL -- A LAP TETEJEN, NEM CSAK A NAPLOBAN.

              Balazs dontese, 2026-09-21 14:00:58 UTC (Discord, fo csatorna,
              message_id 1551594090242510969), egy betu: "b". Az indok, amit
              elfogadott: a szerelo NEM a naplot olvassa, amikor azt kerdezi,
              hogy ezzel most mi van -- ha nem latja ranezesre, ketszer kuldi
              el vagy feleslegesen telefonal.

              ES EZ A SOR PAROS A GOMBBAL: a kikuldes utan a gomb ELTUNIK. Ha
              csak a gomb tunne el es semmi nem kerulne a helyere, a szerelo
              azt latna, hogy a lehetoseg eltunt, nem azt, hogy MEGTORTENT.
            */}
            {kikuldesSora ? (
              <Text style={styles.subject}>{kikuldesSora}</Text>
            ) : null}

            <View style={styles.card}>
              {rows.map((row) => (
                <View key={row.label} style={styles.row}>
                  <Text style={styles.label}>{row.label}</Text>
                  {/*
                    ATKATTINTHATO CSAK AKKOR, HA VAN HOVA.

                    A `serviceJobId` a sorra CSAK jegyhez kotott lapon kerul
                    ra. Enelkul sima szoveg all itt -- egy megnyomhatonak
                    latszo cimke, ami sehova nem visz, rosszabb a sima
                    szovegnel. (Ez a regi indok, es ERVENYBEN MARAD: csak a
                    feltetele valtozott meg, amikor a #735 behozta a
                    hibajegy-kepernyot.)
                  */}
                  {row.serviceJobId ? (
                    <Pressable
                      onPress={() =>
                        router.push({
                          pathname: "/service-jobs/[id]",
                          params: { id: row.serviceJobId as string },
                        })
                      }
                      style={({ pressed }) => [
                        styles.valueLink,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={styles.valueLinkText}>{row.value}</Text>
                    </Pressable>
                  ) : (
                    <Text style={styles.value}>{row.value}</Text>
                  )}
                </View>
              ))}
            </View>

            <Text style={styles.sectionTitle}>Felelősök</Text>
            <View style={styles.card}>
              <Text style={styles.assignees}>
                {worksheetAssigneeLine(
                  data.assignees.map((assignee) => assignee.name),
                )}
              </Text>

              {/*
                AKI CSAK NEZHETI, ANNAK IS LATSZIK A NEVSOR, es a hianyzo gomb
                OKA ki van mondva. Egy gomb, ami egyszeruen nincs ott, ugyanugy
                nez ki, mint egy elromlott -- a szerelo a helyszinen nem tudja
                eldonteni, melyikrol van szo, es keresni fogja.
              */}
              {readOnlyAssigneeNotice ? (
                <Text style={styles.muted}>{readOnlyAssigneeNotice}</Text>
              ) : null}

              {/*
                ALLAPOT-FELTETEL NINCS, ES EZ MERES: a szerver a kiosztast NEM
                koti a lap allapotahoz (`worksheets.service.ts` `setAssignees`),
                mert a kiosztas munkaszervezes, nem a dokumentum tartalma. Egy
                piszkozat-kapu itt olyat tiltana, amit a szerver megenged -- es
                egy tevesen kiosztott lezart lapot senki nem tudna javitani.
              */}
              {capabilities.worksheetsManage && assigneeDraft === null ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Felelősök szerkesztése"
                  accessibilityState={{ disabled: fromCache }}
                  disabled={fromCache}
                  onPress={() =>
                    setAssigneeDraft(
                      data.assignees.map((assignee) => assignee.userId),
                    )
                  }
                  style={({ pressed }) => [
                    styles.assigneeEdit,
                    fromCache && styles.disabled,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.assigneeEditText}>
                    Felelősök szerkesztése
                  </Text>
                </Pressable>
              ) : null}

              {/*
                MENTETT MASOLATBOL NEM MEGY, ES EZT IS KIMONDJUK. A mondat a
                JELEN allapotrol szol, nem altalanos tiltasrol.
              */}
              {capabilities.worksheetsManage && fromCache ? (
                <Text style={styles.muted}>
                  Mentett másolatot nézel, ezért a kiosztás most nem írható át.
                  Térerőnél tudod átosztani a lapot.
                </Text>
              ) : null}

              {assigneeDraft !== null ? (
                <>
                  {/*
                    A HAROM URES-ESET HAROM KULON MONDAT (tolti / elbukott /
                    tenyleg nincs kit valasztani), mert a teendojuk mas. Egy
                    ures doboz a felirat alatt mindharomra ugyanugy nezne ki.
                  */}
                  {assignableNotice ? (
                    <Text style={styles.muted}>{assignableNotice}</Text>
                  ) : null}

                  {(assignableUsers.data?.items ?? []).map((jelolt) => {
                    const kivalasztva = assigneeDraft.includes(jelolt.id);
                    return (
                      <Pressable
                        key={jelolt.id}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: kivalasztva }}
                        accessibilityLabel={jelolt.name}
                        onPress={() =>
                          setAssigneeDraft((elozo) =>
                            elozo === null
                              ? elozo
                              : toggleWorksheetAssignee(elozo, jelolt.id),
                          )
                        }
                        style={({ pressed }) => [
                          styles.assigneeRow,
                          kivalasztva && styles.assigneeRowOn,
                          pressed && styles.pressed,
                        ]}
                      >
                        <Text style={styles.assigneeName}>{jelolt.name}</Text>
                        {kivalasztva ? (
                          <Text style={styles.assigneeCheck}>kiosztva</Text>
                        ) : null}
                      </Pressable>
                    );
                  })}

                  {/*
                    AMI A LISTAN ALL, AZ LESZ A LAP TELJES NEVSORA -- ez nem
                    diszites. A szerver `PUT`-ot vesz, tehat a mentes NEM
                    hozzaad: felulirja. Enelkul a szerelo azt hinne, hogy a
                    korabbi felelosok mellé kerul az uj.
                  */}
                  <Text style={styles.muted}>
                    {assigneeDraft.length === 0
                      ? "Mentés után a lapnak nem lesz felelőse."
                      : `Mentés után pontosan ez a ${assigneeDraft.length} név lesz a lap felelőse.`}
                  </Text>

                  {assigneeError ? (
                    <Text style={styles.lineError}>{assigneeError}</Text>
                  ) : null}

                  <View style={styles.lineRow}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Felelősök mentése"
                      accessibilityState={{
                        disabled: !assigneeChanged || assigneeSaving,
                      }}
                      disabled={!assigneeChanged || assigneeSaving}
                      onPress={() => assigneeMutation.mutate(assigneeDraft)}
                      style={({ pressed }) => [
                        styles.addLineButton,
                        styles.assigneeAction,
                        (!assigneeChanged || assigneeSaving) && styles.disabled,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={styles.addLineText}>
                        {assigneeSaving ? "Mentés..." : "Mentés"}
                      </Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Kiosztás szerkesztésének elvetése"
                      disabled={assigneeSaving}
                      onPress={() => {
                        setAssigneeDraft(null);
                        setAssigneeError(null);
                      }}
                      style={({ pressed }) => [
                        styles.assigneeEdit,
                        styles.assigneeAction,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={styles.assigneeEditText}>Mégsem</Text>
                    </Pressable>
                  </View>
                </>
              ) : null}
            </View>

            {/*
              A FENYKEP-SZAKASZ A MASOLAT-ALLAPOTTOL FUGGETLENUL ITT ALL, csak a
              gombok vannak tiltva. Meresbol jovo szabaly: a hibajegy lapjan ez
              a szakasz elso alakjaban EGYETLEN SZO NELKUL tunt el terero
              nelkul, es egy hianyzo gomb ugyanugy nez ki, mint egy elromlott.

              A JOGOSULTSAG UGYANAZ, MINT A SZERVEREN: a feltoltes SERVICE_MANAGE
              alatt all (`worksheets.controller.ts`, `POST :id/documents`). Aki
              csak nezhet, annak a gomb nem igerhetne olyat, amit a keres
              ugyanabban a percben elutasitana.

              ALLAPOT-FELTETEL NINCS: a tetel-felvitellel ellentetben a fenykep
              NEM piszkozat-fuggo -- a szerver sem koti allapothoz. Egy alairt
              lapra is kerulhet kep.

              ES A GOMBOK MASOLATBOL IS MENNEK (2026-09-17). Korabban a mentett
              masolat allapotaban TILTVA voltak, mert a kep csak a szerverre
              mehetett. A sorba tetel ota epp forditva all: a terero NELKULI
              helyszin az, amiert a sor letezik -- egy tiltott gomb pontosan
              akkor venne el a kepesseget, amikor a legtobbet erne.
            */}
            {/*
              A GALERIA A MANAGE-KAPUN KIVUL ALL. A megnezes `service.view`
              alatt van, a feltoltes `service.manage` alatt -- ha a kapun BELUL
              allna, a szerelo-nezo epp azt nem latna, amiert a kepek
              felkerultek.

              A CSEMPE OSZLOP-ELRENDEZESU, holott ma csak a kep all benne: a
              kephez irhato megjegyzes KULON KARTYAN all (dbc3e19f, migraciot
              kiván), es akkor egy sor szoveg a kep ALA kerul. Igy az a valtozas
              nem rendezi at a szakaszt. ELORE NEM EPITEM MEG: a mezo ma nem
              letezik, es egy ures helykitolto azt allitana, hogy letezik.
            */}
            {/*
              A KIADOTT LAP SAJAT SZAKASZA, A CSATOLMANYOK ELOTT.

              Elol all, mert ez az, amire a partner hivatkozni fog -- a
              csatolmanyok bizonyitekok a munkarol, ez maga a dokumentum.

              A SOR MEGTARTJA AZ UTBAIGAZITAST ("a webes feluleten nyithato
              meg"): a telefonon EGYETLEN dokumentumra sincs letoltesi ut, tehat
              ez az egyetlen mondat, ami megmondja, hol lehet megnyitni. E
              nelkul a szam helyre allna, es csereben az utbaigazitas tunne el.

              URESEN NEM ALL OTT: piszkozat lapnal meg nincs kiadott peldany, es
              egy ures szakasz a telefon kis kepernyojen csak gorgetest visz --
              szemben a webbel, ahol a hely amugy is megvan. A lezaras utan a
              szakasz magatol megjelenik.
            */}
            {kiadottLapok.length > 0 ? (
              <>
                <Text style={styles.sectionTitle}>A kiadott munkalap</Text>
                <View style={styles.card}>
                  {kiadottLapok.map((doc) => (
                    <Text key={doc.id} style={styles.muted}>
                      {describeIssuedSheet(doc)}
                    </Text>
                  ))}
                </View>
              </>
            ) : null}
            <Text style={styles.sectionTitle}>
              Csatolmányok ({csatolmanyok.length})
            </Text>
            <View style={styles.card}>
              {csatolmanyNotice ? (
                <Text style={styles.muted}>{csatolmanyNotice}</Text>
              ) : null}

              {kepek.length > 0 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.galeria}>
                    {kepek.map((kep) => (
                      <Pressable
                        key={kep.id}
                        accessibilityRole="imagebutton"
                        accessibilityLabel={`${kep.fileName} megnyitása nagyban`}
                        onPress={() => setNagyKep(kep.id)}
                        style={({ pressed }) => [
                          styles.csempe,
                          pressed && styles.pressed,
                        ]}
                      >
                        {/*
                          A CSEMPE MOSTANTOL NEM TILTOTT, AMIG A FORRAS
                          HIANYZIK. A regi alak a token megerkezeseig
                          `disabled` volt, es egy kozos "nem tölthető be"
                          feliratot mutatott -- ami a HIANYZO FORRAST es a
                          BETOLTESI HIBAT ugyanugy nevezte meg. A
                          `DocumentImage` a ket esetet KET kulon mondattal
                          valaszolja meg, es a nagy nezet is megnyithato
                          marad, ahol a teljes uzenet elfer.
                        */}
                        <DocumentImage
                          ownerPath={gazdaUtvonal}
                          documentId={kep.id}
                          variant="thumbnail"
                          style={styles.csempeKep}
                          hibaStyle={styles.csempeHiba}
                          resizeMode="cover"
                          accessibilityLabel={kep.fileName}
                        />
                        <Text style={styles.csempeMeret}>
                          {formatDocumentSize(kep.sizeBytes)}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>
              ) : null}

              {/*
                A NEM MEGNEZHETO CSATOLMANY NEV SZERINT ALL, nem csempekent: a
                natív kepbetolto nem rajzol ki PDF-et, es egy torott csempe
                ugyanugy nez ki, mint egy elromlott kep.
              */}
              {egyebek.map((doc) => (
                <Text key={doc.id} style={styles.muted}>
                  {describeUnviewableDocument(doc)}
                </Text>
              ))}
            </View>

            {capabilities.worksheetsManage ? (
              <>
                <Text style={styles.sectionTitle}>Fénykép</Text>
                <View style={styles.card}>
                  {fromCache ? (
                    <Text style={styles.muted}>
                      {WORKSHEET_PHOTO_NOTICE.offlineCopy}
                    </Text>
                  ) : null}
                  <View style={styles.lineRow}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Fénykép készítése"
                      accessibilityState={{ disabled: uploading }}
                      disabled={uploading}
                      onPress={() => void takePhoto()}
                      style={({ pressed }) => [
                        styles.photoButton,
                        uploading && styles.disabled,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={styles.photoButtonText}>Fényképezés</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Kép választása a galériából"
                      accessibilityState={{ disabled: uploading }}
                      disabled={uploading}
                      onPress={() => void pickPhotos()}
                      style={({ pressed }) => [
                        styles.photoButton,
                        uploading && styles.disabled,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={styles.photoButtonText}>Galéria</Text>
                    </Pressable>
                  </View>

                  {/*
                    A HOROG SAJAT UZENETE: a formatum miatt kimaradt fajlok.
                    Egy csendben eldobott HEIC ugyanugy nez ki, mint egy
                    sikeres valasztas.
                  */}
                  {photoPickNotice ? (
                    <Text style={styles.muted}>{photoPickNotice}</Text>
                  ) : null}

                  {/*
                    A KIVALASZTOTT KEPEK MEG NINCSENEK FENT, ES EZT KI KELL
                    MONDANI. Enelkul a szerelo a valasztas utan azt hinne, hogy
                    a kep mar a lapon van, es elmenne a helyszinrol.
                  */}
                  {photos.length > 0 ? (
                    <>
                      <Text style={styles.muted}>
                        {photos.length} kép vár feltöltésre. Még egyik sincs a
                        lapon.
                      </Text>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Kiválasztott képek feltöltése"
                        accessibilityState={{
                          disabled: uploading,
                        }}
                        disabled={uploading}
                        onPress={() => void feltolt()}
                        style={({ pressed }) => [
                          styles.addLineButton,
                          uploading && styles.disabled,
                          pressed && styles.pressed,
                        ]}
                      >
                        <Text style={styles.addLineText}>
                          {uploading ? "Feltöltés..." : "Feltöltés"}
                        </Text>
                      </Pressable>
                    </>
                  ) : null}

                  {photoNotice ? (
                    <Text style={styles.muted}>{photoNotice}</Text>
                  ) : null}
                </View>
              </>
            ) : null}

            {current.description ? (
              <>
                <Text style={styles.sectionTitle}>Leírás</Text>
                <View style={styles.card}>
                  <Text style={styles.value}>{current.description}</Text>
                </View>
              </>
            ) : null}

            <Text style={styles.sectionTitle}>
              Tételek ({current.lines.length})
            </Text>

            {/*
              AMI MEG NEM MENT FEL, AZ NEM LATSZIK A LISTAN -- ES EZT KI KELL
              MONDANI. A lista a szerver valaszabol jon, tehat a sorban allo
              tetel ott NINCS ott. Enelkul a lap ugy nez ki, mintha a mentes meg
              sem tortent volna, es a szerelo ujra beirna ugyanazt.
            */}
            {queuedLinesNotice ? (
              <View style={styles.card}>
                <Text style={styles.muted}>{queuedLinesNotice}</Text>
              </View>
            ) : null}

            {/*
              A FELVITEL CSAK PISZKOZATON, ES CSAK IRASI JOGGAL.
              A szerver ugyanezt koveteli (a sor-vegpontok piszkozat-verziot
              kernek), es ha a gomb ott allna egy lezart lapon, azt igerne,
              hogy megoldodik -- holott a keres ugyanazt a hibat kapna.
            */}
            {capabilities.worksheetsManage && current.status === "DRAFT" ? (
              <View style={styles.card}>
                <Text style={styles.label}>Mit csináltál</Text>
                <TextInput
                  value={description}
                  onChangeText={setDescription}
                  placeholder="Például: szivattyú csere"
                  placeholderTextColor="#5b7d8f"
                  style={styles.input}
                />
                <View style={styles.lineRow}>
                  <View style={styles.lineCell}>
                    <Text style={styles.label}>Mennyi</Text>
                    <TextInput
                      value={quantity}
                      onChangeText={setQuantity}
                      placeholder="1,5"
                      placeholderTextColor="#5b7d8f"
                      keyboardType="decimal-pad"
                      style={styles.input}
                    />
                  </View>
                  <View style={styles.lineCell}>
                    <Text style={styles.label}>Egység</Text>
                    <TextInput
                      value={unit}
                      onChangeText={setUnit}
                      placeholder="óra"
                      placeholderTextColor="#5b7d8f"
                      style={styles.input}
                    />
                  </View>
                </View>
                {/*
                  A SOR ELLENTMONDASA KIMONDVA: munkaorakent szamit, de az
                  egysege nem ora. NEM tiltja a mentest (Balazs dontese,
                  2026-09-21): lehet valodi eset, amikor valaki munkaorat
                  `db`-ben ir. Tereles, nem zar.

                  A MEZOK ALATT ALL: a kis kijelzon az egyseg es a kapcsolo
                  egymas alatt van, tehat az ellentmondas egyikhez sem tartozik
                  kulon -- a ketto EGYUTT adja.
                */}
                {egysegFigyelmeztetes ? (
                  <Text style={styles.egysegFigyelmeztetes}>
                    {egysegFigyelmeztetes}
                  </Text>
                ) : null}
                {/*
                  A FAJTA KAPCSOLO, ES A LETSZAM CSAK MELLETTE LATSZIK.

                  A LETSZAM MEZO ITT ELTUNIK a nem-munka tetelnel, a weben
                  viszont csak TILTOTT -- es a ket dontes nem mond ellent
                  egymasnak. A weben a sorok EGY RACSBAN allnak, tehat egy
                  eltuno cella elcsusztatna az alatta levo sorokat; a telefonon
                  a mezok egymas alatt vannak, ott nincs mit elcsusztatni, es a
                  kis kijelzon minden fololeges sor szamit.
                */}
                <View style={styles.lineRow}>
                  <View style={styles.lineCell}>
                    <Text style={styles.label}>Munkaóra</Text>
                    <View style={styles.switchRow}>
                      <Switch
                        value={isLabor}
                        onValueChange={setIsLabor}
                        accessibilityLabel="Munkaóra-tétel"
                      />
                      <Text style={styles.muted}>
                        {isLabor ? "Beleszámít" : "Nem számít bele"}
                      </Text>
                    </View>
                  </View>
                  {isLabor ? (
                    <View style={styles.lineCell}>
                      <Text style={styles.label}>Hányan</Text>
                      <TextInput
                        value={workerCount}
                        onChangeText={setWorkerCount}
                        placeholder="1"
                        placeholderTextColor="#5b7d8f"
                        keyboardType="number-pad"
                        style={styles.input}
                      />
                    </View>
                  ) : null}
                </View>
                {/*
                  AZ AR NINCS ITT, ES EZ DONTES: az arat az iroda adja meg
                  (Balazs, 2026-09-02).

                  A KORABBI SZOVEG 2026-09-17 OTA HAMIS VOLT, ezert kikerult:
                  azt allitotta a szerelonek, hogy "enelkul a lap nem zarhato
                  le". Balazs aznap ugy dontott, hogy az ar-mezok sehol nem
                  jelennek meg, es ezert a lezarasi feltetel is kikerult -- a
                  lap ma ar nelkul is lezarhato.

                  Egy felhasznaloi mondat, ami egy megszunt feltetelt ir le,
                  rosszabb a semminel: a szerelo olyasmit keres, ami nem all.
                */}
                {lineError ? (
                  <Text style={styles.lineError}>{lineError}</Text>
                ) : null}
                {/*
                  A SORBA KERULES NEM HIBA, ezert nem is a piros dobozban all: a
                  tetel megvan, csak meg a telefonon. Egy piros uzenet itt azt
                  jelentene a szerelonek, hogy nem sikerult -- es ujra beirna.
                */}
                {queued ? <Text style={styles.muted}>{queued}</Text> : null}
                <Pressable
                  disabled={addLine.isPending}
                  onPress={() => addLine.mutate()}
                  style={[
                    styles.addLineButton,
                    addLine.isPending && styles.disabled,
                  ]}
                >
                  <Text style={styles.addLineText}>
                    {addLine.isPending ? "Mentés…" : "Tétel hozzáadása"}
                  </Text>
                </Pressable>
              </View>
            ) : null}
            {current.lines.length === 0 ? (
              <View style={styles.card}>
                <Text style={styles.muted}>Ezen a lapon még nincs tétel.</Text>
              </View>
            ) : (
              current.lines.map((line) => (
                <View key={line.id} style={styles.card}>
                  <Text style={styles.lineTitle}>{line.description}</Text>
                  {line.detail ? (
                    <Text style={styles.muted}>{line.detail}</Text>
                  ) : null}
                  {line.assetNumber ? (
                    <Text style={styles.muted}>{line.assetNumber}</Text>
                  ) : null}
                  {/*
                    AZ UGYFEL SAJAT KODJA, csak ha van, es FELIRATTAL. A felette
                    allo eszkozszam a MIENK, ez pedig az ugyfele: ket csupasz kod
                    egymas alatt pont azt a keveredest hozna, ami ellen a mezo
                    kulon nevet kapott.
                  */}
                  {line.partnerInternalCode ? (
                    <Text style={styles.muted}>
                      Partner azonosítója: {line.partnerInternalCode}
                    </Text>
                  ) : null}
                  <Text style={styles.lineSummary}>
                    {worksheetLineSummary(line, current.currency)}
                  </Text>
                  {/*
                    A TORLES CSAK PISZKOZATON. Egy lezart lapon a gomb olyat
                    igerne, amit a szerver elutasit.
                  */}
                  {capabilities.worksheetsManage &&
                  current.status === "DRAFT" ? (
                    <Pressable
                      disabled={removeLine.isPending}
                      onPress={() => removeLine.mutate(line.id)}
                    >
                      <Text style={styles.removeLine}>Tétel törlése</Text>
                    </Pressable>
                  ) : null}
                </View>
              ))
            )}

            {/*
              AZ OSSZESITES KARTYA (netto, afa, brutto) 2026-09-17-EN KIKERULT.

              Balazs dontese ("B"): az ar-mezok sehol nem jelennek meg, sem a
              weben, sem az appban -- es ezert a lezarasi ar-feltetel is kikerult
              (#809, beolvadt). Az ADAT megmarad, ar tovabbra is rendelheto.

              ES A HELYERE A MUNKAORA KERULT (ugyanaznap este, kulon PR-ben).
              Balazs szo szerint: "a vegen legyen egy ossz munkaora ami
              automatikusan szamol tetelenkent es az osszes tetel eseteben is".
              A tetelenkenti szam a tetel sorabban all, ez itt az OSSZES.
            */}

            {/*
              A SZAM A SZERVERTOL JON, NEM ITT ADODIK OSSZE. Ha a telefon
              szamolna, ugyanaz a szabaly KET feluleten allna (itt es a weben),
              es a ketto elcsuszasa NEMA lenne: ugyanarra a lapra ket kulonbozo
              ora latszana ket kepernyon.

              ES AKKOR IS KIIRJUK, HA NULLA. Egy elrejtett nulla ket allapotot
              mosna ossze: hogy nincs munkaora-tetel a lapon, es hogy a kartya
              elromlott. A "0 óra" allitas; a hianyzo kartya kerdes.
            */}
            <View style={styles.card}>
              <Text style={styles.label}>Összes munkaóra</Text>
              <Text style={styles.laborTotal}>{current.laborHours} óra</Text>
            </View>

            {/*
              AZ ALAIRAS GOMBJA. UGYANAZ A KET FELTETEL, mint a szerveren
              (`AWAITING_SIGNATURE` allapot es `service.manage` jog), es a
              dontes a `worksheet-signature.ts`-ben all -- ott merheto.

              KULON KEPERNYORE VISZ, es ez nem elrendezesi izles: azt a lapot a
              szerelo ODAADJA az ugyfelnek, tehat a tetel-felvitel es a torles
              nem lehet rajta.
            */}
            {/*
              A LEZARO GOMB AZ ALAIRAS ELOTT ALL, es ez nem elrendezesi izles: a
              ketto EGY folyamat ket lepese, es a masodik csak az elso utan
              letezik. Egymas alatt a szerelo latja, hova tart -- kulon
              kepernyon nem latna.

              A FELIRATROL SZOLO BEKEZDEST ATIRTAM, NEM KIEGESZITETTEM, MERT
              EGY UJABB DONTES IRJA FELUL.

              KORABBAN EZ ALLT ITT: "a felirat Balazs szava a folyamatra
              ('Kesz, alairasra'), nem a rendszere ('lezaras'); a gomb NEM
              mondja meg, milyen allapotba lep a lap". Ez egy VALODI dontes
              volt, es nem tevedes -- csak azota Balazs MASKENT dontott.

              2026-09-21 12:10:42 UTC (message_id 1551566340169539655): a
              felirat MONDJA MEG, MIT CSINAL. Az elozmeny a sajat 09-18-i
              mondata: "Ha alairjak akkor zarodik le szerintem es ez igy van
              jol" -- vagyis a regi felirat mellett a SORREND kitalalando
              maradt, es o forditva talalta ki.

              AMI A KET DONTES KOZOTT VALTOZOTT: nem a szohasznalat, hanem az,
              hogy MIT KELL A GOMBNAK ELARULNIA. A regi alak a KOVETKEZO
              lepesre mutatott ("alairasra"); az uj azt mondja meg, mi tortenik
              MOST -- szam, dokumentum, lezaras.
            */}
            {canCloseWorksheetVersion({
              status: current.status,
              worksheetsManage: capabilities.worksheetsManage,
            }) ? (
              <>
                <Pressable
                  disabled={lezaras.isPending}
                  onPress={() => lezaras.mutate()}
                  style={({ pressed }) => [
                    styles.signButton,
                    pressed && styles.pressed,
                  ]}
                >
                  {/*
                    A FELIRAT MEGMONDJA, MIT CSINAL -- UGYANAZ A SZOVEG, MINT A
                    WEBEN (Balazs dontese, 2026-09-21 12:10:42 UTC, message_id
                    1551566340169539655).

                    A "Kesz, alairasra" IGAZ volt, de a lenyeget nem mondta meg:
                    ez a lepes osztja ki a munkalap SZAMAT es allitja elo a
                    DOKUMENTUMOT. Az alairas ezutan jon, es csak az allapotot
                    viszi at -- alairni csak azt lehet, ami mar letezik.

                    KET FELULET, EGY FELIRAT: ha csak az egyik mondana meg, mit
                    csinal, ugyanarra a muveletre mast igernenk.
                  */}
                  <Text style={styles.signButtonText}>
                    {lezaras.isPending ? "Kiállítás…" : "Kiállítás és lezárás"}
                  </Text>
                </Pressable>
                {/*
                  A SZERVER MONDATA MEGY KI, nem sajat masolat. A harom akadaly
                  (nincs tetel, nem piszkozat, hianyzo lapszam-elem) mindegyike
                  sajat mondatot kap a szervertol -- egy masolat itt egyszer
                  elcsuszna, es a telefon MAST mondana, mint a web.
                */}
                {lezarasHiba ? (
                  <Text style={styles.error}>{lezarasHiba}</Text>
                ) : null}
              </>
            ) : null}

            {/*
              AZ ATADAS GOMBJA -- ES A LAP ALLAPOTA ITT SZANDEKOSAN NEM KAPU.

              A lezarasnal `DRAFT` kell, az alairasnal `AWAITING_SIGNATURE`.
              Az atadas MAS kerdesre valaszol: hol van a gep. Egy mar alairt
              lap gepe ugyanugy allhat meg nalunk, es egy piszkozat gepet is
              vissza lehet adni.

              A FELIRAT MEGMONDJA, MELYIK IRANYBA INDUL. Egy allapot-fordito
              "Atadas" felirat mellett a szerelo nem tudja, mit csinal a
              koppintas -- es ket kezelonel csendben az ellenkezojet tenne.
            */}
            {canMarkWorksheetHandover({
              worksheetsManage: capabilities.worksheetsManage,
            }) ? (
              <>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={handoverGombFelirata(data.handedOverAt)}
                  disabled={atadas.isPending}
                  onPress={() =>
                    atadas.mutate(handoverKuldendoErtek(data.handedOverAt))
                  }
                  style={({ pressed }) => [
                    styles.signButton,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.signButtonText}>
                    {atadas.isPending
                      ? "Mentés…"
                      : handoverGombFelirata(data.handedOverAt)}
                  </Text>
                </Pressable>
                {atadasHiba ? (
                  <Text style={styles.error}>{atadasHiba}</Text>
                ) : null}
              </>
            ) : null}

            {canSignWorksheetVersion({
              status: current.status,
              worksheetsManage: capabilities.worksheetsManage,
            }) ? (
              <Pressable
                onPress={() =>
                  router.push({
                    pathname: "/worksheets/sign/[id]",
                    params: { id },
                  })
                }
                style={({ pressed }) => [
                  styles.signButton,
                  pressed && styles.pressed,
                ]}
              >
                {/*
                  A FELIRAT "Aláírás", Balazs kerese (2026-09-18 07:01 UTC):
                  "Szeretnek egy Alairas gombot az aljara."

                  A regi felirat ("Aláíratás az ügyféllel") EGY utat nevezett
                  meg, es Balazs HAROM agat kert ugyanerre a lapra: a partner
                  helyszini alairasat, az elkuldest alairasra, es azt, hogy a
                  sajat szervizesunk irja ala. A szukebb felirat a masik ket
                  agnak nem hagyna helyet.
                */}
                <Text style={styles.signButtonText}>Aláírás</Text>
              </Pressable>
            ) : null}

            {/*
              AZ "ELKULDOM ALAIRASRA" GOMB -- BALAZS SPECJE SZERINT AZ ALAIRAS
              GOMB ALATT (2026-09-18 07:01 UTC): "Az elozo oldalon az a Alairas
              gomb ala Elkuldom alairasra gomb."

              A FELTETEL A `kikuldhetoAlairasra`-BAN ALL, nem itt: ebbol a
              fajlbol semmilyen allitas nem tud elsulni (a telefon renderelo
              nelkul teszteli magat), tehat egy ide irt feltetel merhetetlen
              lenne.

              A VEGPONT 2026-09-21 OTA ALL A SZERVEREN, es eddig CSAK a web
              hivta: a kepesseg megvolt, a telefonrol nem volt bekotve.
            */}
            {kikuldhetoAlairasra({
              status: current.status,
              sentForSignatureAt: current.sentForSignatureAt,
              worksheetsManage: capabilities.worksheetsManage,
            }) ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Elküldöm aláírásra"
                onPress={() =>
                  router.push({
                    pathname: "/worksheets/send-for-signature/[id]",
                    params: { id },
                  })
                }
                style={({ pressed }) => [
                  styles.signButton,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.signButtonText}>Elküldöm aláírásra</Text>
              </Pressable>
            ) : null}

            {/*
              A MUNKANAPLO. Balazs kerese, 2026-09-03: a "Bejegyzes" gombra
              nyilik a mezo, es a "Rogzites" zarja -- a mezo NEM all ott
              mindig, kulonben minden lapon egy ures szovegdoboz fogadna.

              A LAP ALLAPOTA NEM SZAMIT: alairt lapra is lehet bejegyzest irni.
              A naplo arrol szol, MI TORTENT, es a tiltas NEMAN veszitene el egy
              jegyzetet; az engedes LATSZIK, mert a bejegyzesen ott az idopont.
            */}
            <Text style={styles.sectionTitle}>
              Bejegyzések ({entries.data?.items.length ?? 0})
            </Text>

            {capabilities.worksheetsManage ? (
              <View style={styles.card}>
                {entryDraft === null ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setEntryDraft("")}
                    style={styles.addLineButton}
                  >
                    <Text style={styles.addLineText}>Bejegyzés</Text>
                  </Pressable>
                ) : (
                  <>
                    <Text style={styles.label}>Mit csináltál</Text>
                    <TextInput
                      value={entryDraft}
                      onChangeText={setEntryDraft}
                      multiline
                      placeholder="Például: szivattyú csere, a régi ment a szervizbe"
                      placeholderTextColor="#5b7d8f"
                      style={styles.entryInput}
                    />
                    {entryError ? (
                      <Text style={styles.lineError}>{entryError}</Text>
                    ) : null}
                    <Pressable
                      accessibilityRole="button"
                      disabled={addEntry.isPending}
                      onPress={() => addEntry.mutate()}
                      style={[
                        styles.addLineButton,
                        addEntry.isPending && styles.disabled,
                      ]}
                    >
                      <Text style={styles.addLineText}>
                        {addEntry.isPending ? "Mentés…" : "Rögzítés"}
                      </Text>
                    </Pressable>
                  </>
                )}
              </View>
            ) : null}

            {entries.data && entries.data.items.length === 0 ? (
              <View style={styles.card}>
                <Text style={styles.muted}>
                  {describeEmptyEntries(capabilities.worksheetsManage)}
                </Text>
              </View>
            ) : null}

            {entries.data?.items.map((entry) => (
              /*
                A SORRA KOPPINTVA KULON LAP NYILIK (Balazs kerese). A lista
                RESZLETET mutat, nem a teljes szoveget: egy hosszu bejegyzes
                kulonben elnyomna a lap tobbi reszet.
              */
              <Pressable
                key={entry.id}
                accessibilityRole="button"
                onPress={() =>
                  router.push({
                    pathname: "/worksheets/entries/[id]",
                    params: { id, entryId: entry.id },
                  })
                }
                style={styles.card}
              >
                <Text style={styles.muted}>
                  {worksheetEntryByline(entry, (iso) =>
                    formatWorksheetDate(iso),
                  )}
                </Text>
                <Text style={styles.lineTitle} numberOfLines={3}>
                  {entry.body}
                </Text>
              </Pressable>
            ))}

            {/*
              ANYAGIGENYLES. Balazs kerese, 2026-09-22 12:15:46 UTC: a
              szervizes munka kozben veszi eszre, hogy kell valami, felviszi a
              teteleket, kulon "Kuldes" gombbal kuldi el. Ugyanaz a szerkezeti
              minta, mint a munkanaplonal: a felvitel gombra nyilik, nem all
              allandoan a lapon.

              A LAP ALLAPOTA NEM SZAMIT, ugyanugy, mint a bejegyzesnel: az
              anyagigenyt akkor is fel lehet venni, ha a lap mar alairt.
            */}
            <Text style={styles.sectionTitle}>
              Anyagigények ({materialRequests.data?.items.length ?? 0})
            </Text>

            {capabilities.worksheetsManage ? (
              <View style={styles.card}>
                {materialRequestFormOpen ? (
                  <>
                    {materialRequestRows.map((sor, index) => (
                      <View
                        key={index}
                        style={
                          index > 0
                            ? styles.materialRequestRowDivider
                            : styles.materialRequestRow
                        }
                      >
                        <Text style={styles.label}>Tétel neve</Text>
                        <TextInput
                          value={sor.name}
                          onChangeText={(value) =>
                            updateMaterialRequestRow(index, "name", value)
                          }
                          placeholder="Például: 40mm PVC nyomócső"
                          placeholderTextColor="#5b7d8f"
                          style={styles.input}
                        />
                        <View style={styles.lineRow}>
                          <View style={styles.lineCell}>
                            <Text style={styles.label}>Mennyiség</Text>
                            <TextInput
                              value={sor.quantity}
                              onChangeText={(value) =>
                                updateMaterialRequestRow(
                                  index,
                                  "quantity",
                                  value,
                                )
                              }
                              placeholder="Például: 10 méter"
                              placeholderTextColor="#5b7d8f"
                              style={styles.input}
                            />
                          </View>
                          <View style={styles.lineCell}>
                            <Text style={styles.label}>Egység</Text>
                            <TextInput
                              value={sor.unit}
                              onChangeText={(value) =>
                                updateMaterialRequestRow(index, "unit", value)
                              }
                              placeholder="db"
                              placeholderTextColor="#5b7d8f"
                              style={styles.input}
                            />
                          </View>
                        </View>
                        {materialRequestRows.length > 1 ? (
                          <Pressable
                            accessibilityRole="button"
                            onPress={() => removeMaterialRequestRow(index)}
                          >
                            <Text style={styles.removeLine}>Tétel törlése</Text>
                          </Pressable>
                        ) : null}
                      </View>
                    ))}

                    {materialRequestError ? (
                      <Text style={styles.lineError}>
                        {materialRequestError}
                      </Text>
                    ) : null}

                    <View style={styles.lineRow}>
                      <Pressable
                        accessibilityRole="button"
                        onPress={addMaterialRequestRow}
                        style={[styles.addLineButton, styles.lineCell]}
                      >
                        <Text style={styles.addLineText}>Új tétel</Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        disabled={sendNewMaterialRequest.isPending}
                        onPress={() => sendNewMaterialRequest.mutate()}
                        style={[
                          styles.addLineButton,
                          styles.lineCell,
                          sendNewMaterialRequest.isPending && styles.disabled,
                        ]}
                      >
                        <Text style={styles.addLineText}>
                          {sendNewMaterialRequest.isPending
                            ? "Küldés…"
                            : "Küldés"}
                        </Text>
                      </Pressable>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      disabled={sendNewMaterialRequest.isPending}
                      onPress={() => {
                        setMaterialRequestFormOpen(false);
                        setMaterialRequestRows([
                          { name: "", quantity: "", unit: "" },
                        ]);
                        setMaterialRequestError(null);
                      }}
                    >
                      <Text style={styles.removeLine}>Mégse</Text>
                    </Pressable>
                  </>
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      setMaterialRequestFormOpen(true);
                      setMaterialRequestNotice(null);
                    }}
                    style={styles.addLineButton}
                  >
                    <Text style={styles.addLineText}>Anyagigénylés</Text>
                  </Pressable>
                )}
              </View>
            ) : null}

            {/*
              A `notice` A FORMA BEZARASA UTAN IS LATSZIK -- SZANDEKOSAN A
              FORMA-BLOKKON KIVUL ALL. A kuldes sikeres agaban a forma
              bezarodik (`setMaterialRequestFormOpen(false)`), tehat egy a
              blokkon beluli figyelmeztetes soha nem lenne lathato.
            */}
            {materialRequestNotice ? (
              <View style={styles.card}>
                <Text style={styles.egysegFigyelmeztetes}>
                  {materialRequestNotice}
                </Text>
              </View>
            ) : null}

            {materialRequests.data &&
            materialRequests.data.items.length === 0 ? (
              <View style={styles.card}>
                <Text style={styles.muted}>
                  {describeEmptyMaterialRequests(capabilities.worksheetsManage)}
                </Text>
              </View>
            ) : null}

            {materialRequests.data?.items.map((request) => (
              <View key={request.id} style={styles.card}>
                <View style={styles.row}>
                  <Text
                    style={[styles.muted, styles.materialRequestBylineText]}
                  >
                    {materialRequestByline(request, (iso) =>
                      formatWorksheetDate(iso),
                    )}
                  </Text>
                  <View style={styles.statusChip}>
                    <Text style={styles.statusText}>
                      {MATERIAL_REQUEST_STATUS_LABEL[request.status]}
                    </Text>
                  </View>
                </View>
                {request.items.map((item) => (
                  <Text key={item.id} style={styles.materialRequestItem}>
                    {item.name} — {item.quantity} {item.unit}
                  </Text>
                ))}
                {request.status === "DRAFT" ? (
                  <Pressable
                    accessibilityRole="button"
                    disabled={
                      sendDraftMaterialRequest.isPending &&
                      sendDraftMaterialRequest.variables === request.id
                    }
                    onPress={() => sendDraftMaterialRequest.mutate(request.id)}
                    style={[
                      styles.addLineButton,
                      sendDraftMaterialRequest.isPending &&
                        sendDraftMaterialRequest.variables === request.id &&
                        styles.disabled,
                    ]}
                  >
                    <Text style={styles.addLineText}>
                      {sendDraftMaterialRequest.isPending &&
                      sendDraftMaterialRequest.variables === request.id
                        ? "Küldés…"
                        : "Küldés"}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ))}

            {current.signature ? (
              <>
                <Text style={styles.sectionTitle}>Aláírás</Text>
                <View style={styles.card}>
                  <View style={styles.row}>
                    <Text style={styles.label}>Aláíró</Text>
                    <Text style={styles.value}>
                      {current.signature.signerName}
                    </Text>
                  </View>
                  <View style={styles.row}>
                    <Text style={styles.label}>Döntés</Text>
                    <Text style={styles.value}>
                      {current.signature.decision === "ACCEPTED"
                        ? "Elfogadva"
                        : "Elutasítva"}
                    </Text>
                  </View>
                  <View style={styles.row}>
                    <Text style={styles.label}>Dátum</Text>
                    <Text style={styles.value}>
                      {formatWorksheetDate(current.signature.signedAt)}
                    </Text>
                  </View>
                  {current.signature.note ? (
                    <Text style={styles.muted}>{current.signature.note}</Text>
                  ) : null}
                </View>
              </>
            ) : null}

            {/*
              A LÁNC MINDKÉT IRÁNYA. Egy aláírt lap végleges, a munka
              folytatása új lap -- aki a régit nyitja meg, ugyanúgy tudni
              akarja, hol folytatódott, mint fordítva.
            */}
            {continuesFrom || data.continuedBy.length > 0 ? (
              <>
                <Text style={styles.sectionTitle}>Folytatás</Text>
                {continuesFrom ? (
                  <Pressable
                    onPress={() =>
                      router.push({
                        pathname: "/worksheets/[id]",
                        params: { id: continuesFrom.id },
                      })
                    }
                    style={({ pressed }) => [
                      styles.card,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.label}>Ennek a folytatása</Text>
                    <Text style={styles.value}>
                      {worksheetLabelOrDraft(continuesFrom.number)}
                    </Text>
                  </Pressable>
                ) : null}
                {data.continuedBy.map((link) => (
                  <Pressable
                    key={link.id}
                    onPress={() =>
                      router.push({
                        pathname: "/worksheets/[id]",
                        params: { id: link.id },
                      })
                    }
                    style={({ pressed }) => [
                      styles.card,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.label}>Itt folytatódott</Text>
                    <Text style={styles.value}>
                      {worksheetLabelOrDraft(link.number)}
                    </Text>
                  </Pressable>
                ))}
              </>
            ) : null}

            {olderVersions && olderVersions.length > 0 ? (
              <>
                <Text style={styles.sectionTitle}>Korábbi változatok</Text>
                {olderVersions.map((version) => (
                  <View key={version.id} style={styles.card}>
                    <View style={styles.row}>
                      <Text style={styles.label}>
                        {worksheetLabelOrDraft(version.label)}
                      </Text>
                      <Text style={styles.value}>
                        {worksheetStatusLabel[version.status]}
                      </Text>
                    </View>
                    {version.changeReason ? (
                      <Text style={styles.muted}>{version.changeReason}</Text>
                    ) : null}
                  </View>
                ))}
              </>
            ) : null}
          </>
        ) : null}
      </ScrollView>

      {/*
        A NAGY KEP RATETKENT, NEM `Modal`-kent es nem masik kepernyokent.

        Masik kepernyore navigalva a lap allapota (a felvitt tetel szovege, a
        megnyitott felelos-szerkeszto) ELVESZNE, mert a kepernyo ujra epulne --
        ugyanaz az indok, amiert a matrica-beolvaso is ratetkent nyilik.
      */}
      {nagyKep ? (
        <View style={styles.nagyRatet}>
          <DocumentImage
            ownerPath={gazdaUtvonal}
            documentId={nagyKep}
            variant="original"
            style={styles.nagyKep}
            hibaStyle={styles.nagyKepHiba}
            resizeMode="contain"
            accessibilityLabel="A csatolmány nagyban"
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Kép bezárása"
            onPress={() => setNagyKep(null)}
            style={({ pressed }) => [
              styles.addLineButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.addLineText}>Bezárás</Text>
          </Pressable>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#071827" },
  container: { padding: 18, paddingBottom: 48, gap: 12 },
  eyebrow: {
    color: "#52d6c7",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.4,
  },
  titleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
  },
  title: { color: "#f4fbff", flex: 1, fontSize: 24, fontWeight: "900" },
  statusChip: {
    backgroundColor: "#123f3b",
    borderRadius: 999,
    flexShrink: 0,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  statusText: { color: "#6de0ce", fontSize: 11, fontWeight: "800" },
  subject: { color: "#d9edf7", fontSize: 16, fontWeight: "700" },
  entryInput: {
    backgroundColor: "#071827",
    borderRadius: 10,
    color: "#f4fbff",
    minHeight: 110,
    padding: 12,
    textAlignVertical: "top",
  },
  sectionTitle: {
    color: "#f4fbff",
    fontSize: 15,
    fontWeight: "800",
    marginTop: 6,
  },
  card: {
    backgroundColor: "#0d2b40",
    borderColor: "#1c4963",
    borderWidth: 1,
    borderRadius: 16,
    gap: 8,
    padding: 14,
  },
  row: {
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },
  label: { color: "#789cad", fontSize: 12, fontWeight: "700" },
  value: { color: "#f4fbff", flex: 1, fontSize: 14, textAlign: "right" },
  /* A HIVATKOZAS LATSZIK ANNAK: sajat szin, hogy a sima ertektol elvaljon. */
  valueLink: { flex: 1 },
  valueLinkText: {
    color: "#6de0ce",
    fontSize: 14,
    textAlign: "right",
    textDecorationLine: "underline",
  },
  total: {
    color: "#6de0ce",
    flex: 1,
    fontSize: 16,
    fontWeight: "900",
    textAlign: "right",
  },
  assignees: { color: "#f4fbff", fontSize: 14 },
  lineTitle: { color: "#f4fbff", fontSize: 15, fontWeight: "800" },
  lineSummary: { color: "#6de0ce", fontSize: 13, fontWeight: "700" },
  muted: { color: "#789cad", fontSize: 12 },
  /*
    Balazs kepernyofotoja, 2026-09-23 20:52: az anyagigeny-sor allapot-cimkeje
    kilogott a kartyabol, mert a mellette allo `muted` szoveg (a byline) nem
    kapott flex-et, tehat a sajat termeszetes szelesseget vette fel egy
    `justifyContent: "space-between"` sorban, es kitolta a cimket. A `muted`
    KOZOS stilus, mashol is hasznaljak -- ezert nem oda kerult a javitas,
    hanem ide, egy nevesitett kiegeszitobe, csak erre a sorra alkalmazva
    (`style={[styles.muted, styles.materialRequestBylineText]}`).
  */
  materialRequestBylineText: { flex: 1 },
  egysegFigyelmeztetes: {
    color: "#ffd48a",
    fontSize: 13,
    lineHeight: 18,
    marginTop: 8,
  },
  error: {
    color: "#fecaca",
    backgroundColor: "#541b2b",
    padding: 12,
    borderRadius: 10,
  },
  input: {
    backgroundColor: "#08192a",
    borderColor: "#17394f",
    borderRadius: 10,
    borderWidth: 1,
    color: "#f4fbff",
    marginTop: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  lineRow: { flexDirection: "row", gap: 10, marginTop: 8 },
  laborTotal: {
    fontSize: 20,
    fontWeight: "700",
    color: "#e8f4f8",
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 44,
  },
  lineCell: { flex: 1 },
  lineError: { color: "#ffb4ab", fontSize: 12, marginTop: 8 },
  addLineButton: {
    backgroundColor: "#177b74",
    borderRadius: 10,
    marginTop: 10,
    padding: 12,
  },
  addLineText: { color: "#fff", fontWeight: "900", textAlign: "center" },
  removeLine: {
    color: "#ffb4ab",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 8,
  },
  signButton: {
    backgroundColor: "#177b74",
    borderRadius: 12,
    marginTop: 6,
    padding: 16,
  },
  signButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "900",
    textAlign: "center",
  },
  assigneeEdit: {
    backgroundColor: "#12415c",
    borderColor: "#1c4963",
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 8,
    padding: 12,
  },
  assigneeEditText: {
    color: "#f4fbff",
    fontWeight: "800",
    textAlign: "center",
  },
  assigneeAction: { flex: 1, marginTop: 0 },
  assigneeRow: {
    alignItems: "center",
    backgroundColor: "#08192a",
    borderColor: "#17394f",
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 6,
    padding: 12,
  },
  assigneeRowOn: { borderColor: "#52d6c7" },
  assigneeName: { color: "#f4fbff", fontSize: 14 },
  assigneeCheck: { color: "#6de0ce", fontSize: 12, fontWeight: "800" },
  photoButton: {
    backgroundColor: "#12415c",
    borderColor: "#1c4963",
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    padding: 12,
  },
  photoButtonText: {
    color: "#f4fbff",
    fontWeight: "800",
    textAlign: "center",
  },
  galeria: { flexDirection: "row", gap: 10, paddingVertical: 4 },
  csempe: { gap: 4, width: 104 },
  csempeKep: {
    width: 104,
    height: 104,
    borderRadius: 10,
    backgroundColor: "#08192a",
    borderColor: "#17394f",
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  /*
    A HIBA-DOBOZ KERETE A CSEMPEN ES NAGYBAN MAS MERET.

    A csempe 104 pont szeles: ott csak annyi fer ki, hogy MERES, es aki azt
    latja, rakoppint. A TELJES szoveg a nagy nezetben olvashato, ahol van hely.
  */
  csempeHiba: { padding: 4 },
  nagyKepHiba: {
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  csempeMeret: { color: "#789cad", fontSize: 11, textAlign: "center" },
  nagyRatet: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#03101acc",
    justifyContent: "center",
    gap: 16,
    padding: 20,
  },
  nagyKep: { flex: 1, width: "100%", borderRadius: 12 },
  materialRequestRow: { gap: 4 },
  materialRequestRowDivider: {
    gap: 4,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#17394f",
  },
  materialRequestItem: { color: "#f4fbff", fontSize: 14 },
  disabled: { opacity: 0.55 },
  pressed: { opacity: 0.75 },
});
