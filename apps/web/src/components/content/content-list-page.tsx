"use client";

import {
  Alert,
  Badge,
  Card,
  EmptyState,
  PageHeader,
  Select,
  Skeleton,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type ContentListItem,
  type ContentViewerRole,
} from "@acropora/types";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { contentApi } from "@/lib/api/content";
import {
  CONTENT_ROLE_LABELS,
  CONTENT_STATE_LABELS,
  CONTENT_WAITS_ON_LABELS,
  contentAgeLabel,
  contentImageLabel,
  oldestAge,
  oldestFirst,
} from "./content-labels";
import { ContentRowActions } from "./content-row-actions";

/**
 * A NÉZET NEM CSAK SZEREP LEHET, HANEM „AMI RÁM VÁR" IS.
 *
 * MIÉRT A VÁLASZTÓBAN, ÉS NEM KÜLÖN SZEKCIÓBAN: így egyetlen helyen dől el, mit
 * néz a felhasználó, és LÁTSZIK, hogy szűrt listát lát -- egy kattintással
 * bármelyik szerepre válthat. Egy külön, mindig ott álló „rám vár" doboz
 * ugyanezt mutatná, de nem mondaná meg, hogy a többi tétel hova lett.
 */
type ContentView = "mine" | ContentViewerRole;

const VIEWS: ContentView[] = [
  "mine",
  "approver",
  "reviewer",
  "author",
  "sender",
];

const VIEW_LABELS: Record<ContentView, string> = {
  mine: "ami rám vár",
  approver: CONTENT_ROLE_LABELS.approver,
  reviewer: CONTENT_ROLE_LABELS.reviewer,
  author: CONTENT_ROLE_LABELS.author,
  sender: CONTENT_ROLE_LABELS.sender,
};

/**
 * A TARTALOM-SOR LISTÁJA: ami RÁM vár.
 *
 * EZ AZ ELSŐ SZELET, ÉS SZÁNDÉKOSAN ENNYI. Balázs panasza nem a jóváhagyásról
 * szólt, hanem arról, hogy sem ő, sem Luca nem látja, mi készült el és mi vár
 * rájuk. Egy működő lista ezt megoldja; a naptár nézet szép, de nem az a
 * fájdalom, és külön szelet.
 *
 * AZ ALAPÉRTELMEZETT SZEREP A `approver`, nem a `author`. Aki ezt az oldalt
 * először megnyitja, az a két nevesített ember egyike lesz, és nekik a
 * jóváhagyásra váró sor a kérdés. Egy szerző-nézet alapból üres listát adna
 * nekik, és az pontosan az a benyomás, amitől az egész felület készül.
 */
export function ContentListPage() {
  const { session } = useAuth();
  // AZ ALAPÉRTELMEZETT NÉZET AZ, AMI RÁM VÁR. Balázs panasza szó szerint az volt,
  // hogy nem látja, mi vár rá; egy szerep-választó, amit előbb be kell állítani,
  // ezt a kérdést egy lépéssel odébb tolja.
  const [view, setView] = useState<ContentView>("mine");
  const [items, setItems] = useState<ContentListItem[] | null>(null);
  const [notCovered, setNotCovered] = useState<
    { role: ContentViewerRole; reason: string }[]
  >([]);
  const [waitingForImage, setWaitingForImage] = useState<
    ContentListItem[] | null
  >(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.CONTENT_VIEW),
  );
  const token = session?.token ?? "";

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canView) return;
      setLoading(true);
      setError(null);
      try {
        // A KÉT LEKÉRDEZÉS KÜLÖN MEGY, mert két különböző kérdés: az egyik a
        // szöveg útja, a másik a képé. Egy összevont hívás a kettőt egy
        // listává mosná, és épp az a NÉGY poszt tűnne el benne, ami ma két hete
        // óta kizárólag fotóra vár.
        const [waiting, images] = await Promise.all([
          view === "mine"
            ? contentApi.waitingOnMe(token, signal)
            : contentApi.waiting(token, view, signal),
          contentApi.waitingForImage(token, signal),
        ]);
        // A KÉT VÁLASZ ALAKJA MÁS, ÉS SZÁNDÉKOSAN: a „rám vár" nézet megnevezi,
        // mit NEM fed le. A szerep szerinti nem, mert ott a felhasználó maga
        // választotta ki, mit néz.
        setItems(Array.isArray(waiting) ? waiting : waiting.items);
        setNotCovered(Array.isArray(waiting) ? [] : waiting.notCovered);
        setWaitingForImage(images);
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(
            cause instanceof Error
              ? cause.message
              : "A tartalom-lista nem tölthető be.",
          );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [canView, view, token],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // EGY SIKERES LÉPÉS UTÁN ÚJRA KELL KÉRDEZNI, mert a tétel állapota
  // megváltozott, és ezzel az is, mit lehet belőle lépni. A régi sor
  // gombjai olyan lépéseket kínálnának, amiket a szerver már elutasít.
  const reload = useCallback(() => {
    void load();
  }, [load]);

  if (!canView) {
    return (
      <Alert
        title="Nincs jogosultságod"
        description="A tartalom-sor megtekintéséhez content.view jog kell."
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tartalom"
        description="Ami rád vár, és ami képre vár."
      />

      {/*
        AZ ÖSSZEGZŐ CSÍK LEGFELÜL, A SZEREP-VÁLASZTÓ ELŐTT IS.
        Aki megnyitja az oldalt, ne előbb egy választót értelmezzen, és csak
        görgetés után tudja meg, hogy négy tétel áll két hete. A darabszám
        önmagában kevés: a legrégebbi KORA az, ami megmondja, sürgős-e.
      */}
      {/*
        A HIBA LEGFELUL ALL, a szekciok elott. Az atrendezes utan a piros
        uzenet lejjebb csuszott volna, mint ahol korabban volt -- egy hiba,
        amit gorgetni kell, ugyanolyan lathatatlan, mint amelyik nincs is ott.
      */}
      {error ? (
        <Alert
          variant="danger"
          title="A lista nem tölthető be"
          description={error}
        />
      ) : null}

      <StaleSummary items={waitingForImage} />

      {/*
        A KÉPRE VÁRÓ LISTA ELÖL ÁLL, a szerep szerinti sor ELŐTT.
        Nem esztétika: a képre váró tételek HETEK óta állnak, a jóváhagyási sor
        pedig rutin. Ha a szerep szerinti lista hosszú lesz (és lesz), a régóta
        álló tételek a görgetési vonal alá kerülnének -- vagyis pont az válna
        láthatatlanná, amiért a felület készül.

        És soha nem függ a szerep-választótól: a kép Lucára vár, akárki írta a
        szöveget.
      */}
      {loading ? (
        <Skeleton className="h-32" />
      ) : (
        <ContentSection
          title="Képre vár"
          items={waitingForImage && oldestFirst(waitingForImage)}
          empty="Semmi nem vár képre."
          onDone={reload}
        />
      )}

      {/*
        A SZEREP-VÁLASZTÓ LEJJEBB ÉS KISEBB SÚLLYAL. Kell, mert a lektoroknak és
        a küldőknek ez a belépési pontjuk -- de nem az első dolog, amit egy
        jóváhagyónak látnia kell.
      */}
      <label className="block space-y-1 border-t border-slate-200 pt-4">
        <span className="text-sm text-slate-500">Kinek a szemével</span>
        <Select
          value={view}
          onChange={(event) => setView(event.target.value as ContentView)}
        >
          {VIEWS.map((value) => (
            <option key={value} value={value}>
              {VIEW_LABELS[value]}
            </option>
          ))}
        </Select>
      </label>

      {/*
        AMIT EZ A NÉZET NEM FED LE, AZ ITT ÁLL, NEM ELHALLGATVA.
        Egy „ami rám vár" lista, ami egy negyedét kihagyja és erről nem szól,
        azt a hamis megnyugvást adja, hogy minden ott van. Aki nem tudja, hogy
        hiányzik valami, a hiányzót nem létezőnek hiszi.
      */}
      {view === "mine" && notCovered.length > 0 ? (
        <p className="text-xs text-slate-500">
          {notCovered.map((entry) => entry.reason).join(" ")}
        </p>
      ) : null}

      {loading ? (
        <Skeleton className="h-32" />
      ) : (
        <ContentSection
          title={VIEW_LABELS[view]}
          items={items}
          empty="Ebben a nézetben most nincs tétel."
          onDone={reload}
        />
      )}
    </div>
  );
}

/**
 * HÁROM ÁLLAPOT VAN, NEM KETTŐ: van adat, nincs adat, és NEM TUDJUK.
 *
 * A harmadikat eddig a másodikként mutattuk: hiba esetén a lekérdezés `null`-t
 * hagyott, az üresre esett, és a felület azt állította, hogy „Semmi nem vár
 * képre" -- holott a valóság az, hogy nem tudjuk, mi vár. **Egy hibát
 * SIKERKÉNT jelenítettünk meg**: aki ránéz, megnyugszik és elmegy.
 *
 * Ez ugyanaz az alak, mint a mai többi leletünk: a nulla eredmény nem a világ
 * tulajdonsága, hanem a kérdésé -- itt a lekérdezésé.
 *
 * A MINTA A REPÓBÓL JÖN, nem én találtam ki: az eszközlista ugyanígy csak akkor
 * mutat üres-állapotot, ha a betöltés SIKERÜLT (`data ? <EmptyState/> : null`).
 * A `null` bemenet itt ugyanazt jelenti.
 */
function ContentSection({
  title,
  items,
  empty,
  onDone,
}: {
  title: string;
  items: ContentListItem[] | null;
  empty: string;
  onDone: () => void;
}) {
  // NEM TUDJUK: a hibaüzenet már ott áll fölötte, és egy üres szekció csak
  // ellentmondana neki.
  if (!items) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">
        {title} ({items.length})
      </h2>
      {items.length === 0 ? (
        <EmptyState
          title={empty}
          description="Ha ez váratlan, töltsd újra az oldalt."
        />
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <ContentRow key={item.id} item={item} onDone={onDone} />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * AZ ÖSSZEGZŐ CSÍK: hány tétel vár képre, és mióta áll a legrégebbi.
 *
 * ÜRES LISTÁRA NEM JELENIK MEG. Egy „0 tétel vár képre" csík minden nap ott
 * állna, és pár nap alatt megtanítaná az olvasót, hogy ne nézzen oda -- pont
 * akkorra, amikor először mondana valamit.
 */
function StaleSummary({ items }: { items: ContentListItem[] | null }) {
  // A `null` itt is NEM TUDJUK, nem nulla: hiba után a csík elmarad, és a
  // hibaüzenet beszél helyette.
  const oldest = items && oldestAge(items);
  if (!items || items.length === 0 || !oldest) return null;

  return (
    <Card className="flex items-center gap-3 p-4">
      {/*
        HORGONY BALRA, DE FELIRAT NÉLKÜLI SZÁM NÉLKÜL. A darabszám a
        MONDATBAN áll: egy csupasz szám egy jelvényben lehet üzenetszám vagy
        értesítés is, és csak a cím elolvasása után derül ki, hogy tételekről
        van szó. A csík egyetlen dolga, hogy egy pillantás alatt mondjon
        valamit -- ha ehhez három darabot kell összeolvasni, akkor nem csík,
        hanem egy negyedik lista.
      */}
      <span
        aria-hidden
        className={
          oldest.stale
            ? "size-2.5 shrink-0 rounded-full bg-amber-500"
            : "size-2.5 shrink-0 rounded-full bg-slate-300"
        }
      />
      <p className="text-sm">
        <strong className="font-semibold">{items.length} tétel</strong> vár
        képre
        {/*
          A „RÉGÓTA" SZÓ CSAK AKKOR ÁLL OTT, HA IGAZ. Egy két napja készült
          tételre kimondva a szó hamis állítás lenne, és pont attól a
          figyelmeztető erejétől fosztaná meg, amiért picasso kiemeltetni
          kérte. Ugyanaz a szabály, mint a többi jelzésnél a lapon: ami mindig
          ott áll, az nem jelent semmit.
        */}
        {oldest.stale ? (
          <strong className="font-semibold"> régóta</strong>
        ) : null}
        {" -- a legrégebbi "}
        {oldest.text}
      </p>
    </Card>
  );
}

function ContentRow({
  item,
  onDone,
}: {
  item: ContentListItem;
  onDone: () => void;
}) {
  const image = contentImageLabel(item);
  const age = contentAgeLabel(item.updatedAt);
  // TELEFONON A SOR ALAKJÁT NE A CÍM HOSSZA DÖNTSE EL. Amíg a kártya maga
  // tördelt, a jelvények hol a cím mellett maradnak, hol leválnak: három
  // próbasoron háromféle alak jött ki, szándék nélkül. Ezért keskeny
  // képernyőn a cím és a jelvény-sor MINDIG egymás alatt áll, sm mérettől
  // pedig a mai egysoros alak jön vissza.
  return (
    <Card className="flex flex-col items-stretch gap-2 p-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3">
      <div className="min-w-0">
        <p className="truncate font-medium">{item.title}</p>
        <p className="text-sm text-muted-foreground">
          {CONTENT_STATE_LABELS[item.state]} &middot; vár:{" "}
          {CONTENT_WAITS_ON_LABELS[item.state]}
        </p>
      </div>
      {/*
        A JELVÉNY-SOR MAGA IS TÖRDELHET. A dátum csak néha van ott, tehát a
        sor hossza soronként más; wrap nélkül a harmadik jelvény keskeny
        képernyőn kicsordulna.
      */}
      <div className="flex flex-wrap items-center gap-2">
        {/*
          A KOR-CÍMKE MINDEN SORON. A szekció létezése kiemeli a csoportot, az
          egymáshoz képesti sürgősséget viszont csak ez mutatja meg: e nélkül a
          hét hete álló és a két napja készült tétel egyformán néz ki.
        */}
        <Badge variant={age.stale ? "warning" : "neutral"}>{age.text}</Badge>
        <Badge variant={image.waiting ? "warning" : "neutral"}>
          {image.text}
        </Badge>
        {/*
          A TERVEZETT DÁTUM CSAK AKKOR JELENIK MEG, HA VAN. Egy „nincs dátum"
          felirat minden ötletnél ott állna, és a szemet elvonná arról a
          néhányról, aminek TÉNYLEG van határideje.
        */}
        {item.plannedFor ? (
          <Badge variant="neutral">
            {new Date(item.plannedFor).toLocaleDateString("hu-HU")}
          </Badge>
        ) : null}
      </div>
      {/*
        A CSELEKVÉS A JELVÉNYEK UTÁN, KÜLÖN CSOPORTBAN. Keskeny képernyőn ez a
        harmadik sor, széles képernyőn a sor jobb vége -- ugyanaz a tördelési
        szabály, mint a jelvényeknél, tehát a sor alakja nem a tartalomtól függ.
      */}
      <ContentRowActions item={item} onDone={onDone} />
    </Card>
  );
}
