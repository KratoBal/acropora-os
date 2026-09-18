"use client";

import { Button, Input } from "@acropora/ui";
import { useEffect, useRef, useState } from "react";

import { formatDateTime } from "@/components/worksheets/worksheet-labels";
import { formatFileSize } from "@/lib/format/file-size";

/**
 * A CSATOLMANYOK GALERIAJA -- A KEP LATSZIK, NEM LETOLTODIK.
 *
 * Balazs kerese (2026-09-17): "a feltoltott fenykepek sehol nem jelnnek meg.
 * marmint nem tudom megnezni se a mobil appban se a weben. jo lenne valami
 * galeria szeru".
 *
 * A KORABBI VISELKEDES: a `Letoltes` gomb blobot kert, csinalt egy horgonyt, es
 * MENTETTE a fajlt. Aki latni akarta a helyszini fenykepet, annak le kellett
 * toltenie, meg kellett keresnie a gepen, es meg kellett nyitnia.
 *
 * === MIERT OBJEKTUM-URL, ES NEM SIMA `<img src="...">` ===
 *
 * A letolto vegpont `attachment` dispoziciot ad, es BEARER TOKENT var. Egy
 * `<img>` elem nem kuld Authorization fejlecet, tehat kozvetlenul nem tudna
 * lehivni a kepet. A blob viszont MAR MEGVAN ugyanazon a hivason, amit a
 * letoltes hasznal -- objektum-URL-t csinalunk belole, es AZ megy a kep
 * forrasakent. A SZERVERT EHHEZ NEM KELL ATIRNI.
 *
 * === AMI EBBOL KOVETKEZIK, ES KI VAN MONDVA, NEM ELREJTVE ===
 *
 * NINCS BELYEGKEP-VEGPONT, tehat a csempek a TELJES MERETU fajlbol keszulnek.
 * Egy tiz fenykepes jegy tizszer nehany megabajtot tolt le. Ez ma elviselheto
 * (a feltoltes fajlonkent 10 MB-nal all meg), de NEM skalazodik felfele: ha a
 * jegyeken tucatnyi kep gyulik, egy szerver-oldali belyegkep-ut kell hozza --
 * az viszont uj vegpont, tehat dontes, nem az en lepesem.
 *
 * Amit addig is teszunk ellene: a lehivas KORLATOZOTT PARHUZAMOSSAGGAL megy,
 * es a csempek EGYESEVEL jelennek meg, ahogy megjonnek. Igy a lap hasznalhato
 * marad, mielott az utolso kep leerne.
 *
 * === A NEM KEP CSATOLMANY MARAD LETOLTHETO ===
 *
 * A PDF-et nezni nem tudjuk a lapon, es nem is akarjuk: azt tenyleg le kell
 * tolteni. A ket fajta ezert KET LISTABAN all, nem egy vegyesben -- egy
 * galeria, amiben egy elem csak egy ikon, ugy nez ki, mintha az a kep nem
 * toltodott volna be.
 */

/** Egy csatolmany annyi mezoje, amennyit a galeria olvas. */
export interface ServiceDocumentGalleryItem {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  /**
   * MIT LATUNK A KEPEN. `null`, ha nincs felirat.
   *
   * A HIANY EGYFELE ALAKBAN ALL, ugyanugy, mint a szerveren: kulonben a "nincs
   * felirat" es a "szandekosan ures felirat" ket allapota egyformanak tunne, es
   * a rajzolonak ket agat kellene nyitnia ugyanarra a hianyra.
   */
  caption: string | null;
  createdAt: string;
}

/**
 * EGYSZERRE ENNYI KEP TOLTODIK. Nem a memoria miatt (az attol fugg, hany kep
 * van), hanem hogy az elso csempek HAMAR megjelenjenek: egy husz parhuzamos
 * keres mind a huszat egyszerre, a vegen adna vissza.
 */
const EGYSZERRE = 3;

type KepAllapot =
  { allapot: "tolt" } | { allapot: "kesz"; url: string } | { allapot: "hiba" };

export function isGalleryImage(item: ServiceDocumentGalleryItem): boolean {
  return item.contentType.startsWith("image/");
}

/**
 * A GALERIA GENERIKUS AZ ELEM TIPUSARA, ES EZ NEM DISZ.
 *
 * A harom lap harom KULONBOZO osszefoglalo-tipust hasznal (hibajegy, munkalap,
 * eszkoz), es a visszahivasoknak a SAJAT sorukat kell visszakapniuk, nem a
 * galeria szuk masolatat. Enelkul minden hivo egy `find`-dal keresne vissza a
 * sajat sorat az azonosito alapjan -- harom helyen, harom eselyt adva arra,
 * hogy az egyik `undefined`-ot talal es csendben nem csinal semmit.
 */
export function ServiceDocumentGallery<T extends ServiceDocumentGalleryItem>({
  items,
  loadBlob,
  onDownload,
  onDelete,
  onSaveCaption,
  itemLabel,
  emptyText,
}: {
  items: readonly T[];
  /** A letolto hivas, amit a lap mar hasznal. A galeria nem ismer vegpontot. */
  loadBlob: (id: string) => Promise<Blob>;
  onDownload: (item: T) => void;
  /** `undefined`, ha a nezonek nincs joga torolni. */
  onDelete?: (item: T) => void;
  /**
   * A FELIRAT MENTESE. `undefined`, ha a nezonek nincs joga irni.
   *
   * A JOG HIANYA ITT IS A FUGGVENY HIANYA, nem egy `false` zaszlo: igy a
   * csempe nem tud "szerkesztheto, de le van tiltva" allapotba kerulni. A
   * felirat OLVASHATO marad annak is, aki nem irhatja.
   *
   * A `null` a TORLES: a hivo ugyanezen az uton veszi le a feliratot.
   */
  onSaveCaption?: (item: T, caption: string | null) => Promise<void>;
  /**
   * EGY ROVID CIMKE A CSATOLMANY FAJTAJARA -- `null`, ha nincs mit mondani.
   *
   * MIERT VISSZAHIVAS, ES MIERT NEM MEZO AZ ELEMEN: a fajta a GAZDAE, nem a
   * galeriae. A hibajegyen ket ertek van (fenykep, egyeb), es a kepernyo egyiket
   * sem irja ki -- ott a cimke csak zaj lenne. Az eszkozon NEGY all (szamla,
   * garanciajegy, hasznalati utasitas, egyeb), es ott a fajta az elso, amit a
   * kezelo keres: egy szamlat es egy garancialevelet a fajlnev nem kulonboztet
   * meg.
   *
   * ELHAGYHATO, tehat a ket mai hivo (hibajegy, munkalap) VALTOZATLAN marad --
   * nem kapnak ures cimke-helyet, es nem kell semmit atvezetni rajtuk.
   */
  itemLabel?: (item: T) => string | null;
  emptyText: string;
}) {
  const kepek = items.filter(isGalleryImage);
  const egyeb = items.filter((item) => !isGalleryImage(item));

  const [allapotok, setAllapotok] = useState<Record<string, KepAllapot>>({});
  const [nagyitott, setNagyitott] = useState<T | null>(null);
  /**
   * A FELIRAT SZERKESZTESE EGYSZERRE EGY CSEMPEN NYITHATO.
   *
   * `null`, ha egyik sincs nyitva. Nem csempenkenti allapot: ket egyszerre
   * nyitott mezo mellett a mentes gombja mellett allna egy masik, el nem
   * mentett szoveg -- es a felhasznalo nem latna, melyiket mentette.
   */
  const [szerkesztett, setSzerkesztett] = useState<string | null>(null);
  const [piszkozat, setPiszkozat] = useState("");
  const [mentes, setMentes] = useState(false);
  const [feliratHiba, setFeliratHiba] = useState<string | null>(null);

  /**
   * A LETOLTO FUGGVENY `ref`-BEN ALL, ES NEM A FUGGOSEGI LISTABAN.
   *
   * A hivo tipikusan HELYBEN irja meg (`(id) => api.download(token, jobId, id)`),
   * tehat minden szulo-ujrarajzolasnal UJ fuggveny-azonossag keletkezik. A
   * fuggosegi listaban ez azt jelentene, hogy a szulo BARMELYIK allapot-
   * valtozasa -- egy begepelt betu a megjegyzes-mezoben -- UJRATOLTENE az
   * osszes fenykepet. A hiba nema lenne: a kepek jok, csak a halozat dolgozik.
   *
   * Igy viszont a galeria a HIVOTOL FUGGETLENUL helyes, nem attol, hogy az
   * emlekezett-e `useCallback`-re.
   */
  const letolt = useRef(loadBlob);
  letolt.current = loadBlob;

  const kulcs = kepek.map((item) => item.id).join("|");

  useEffect(() => {
    /**
     * AZ `ervenyes` ZASZLO NEM DISZ: a React fejlesztoi modban KETSZER futtatja
     * az effektet. Nelkule a masodik futas ugyanazokat a kepeket toltene le
     * megegyszer, es az elso futas takaritasa visszavonna az epp beallitott
     * URL-eket -- torott kepek, hibauzenet nelkul.
     */
    let ervenyes = true;
    const sajatUrlek: string[] = [];
    const sor = [...kepek];
    setAllapotok(
      Object.fromEntries(
        sor.map((item) => [item.id, { allapot: "tolt" } as KepAllapot]),
      ),
    );

    async function futoszalag() {
      for (;;) {
        const kovetkezo = sor.shift();
        if (!kovetkezo || !ervenyes) return;
        try {
          const blob = await letolt.current(kovetkezo.id);
          if (!ervenyes) return;
          const url = URL.createObjectURL(blob);
          sajatUrlek.push(url);
          setAllapotok((elozo) => ({
            ...elozo,
            [kovetkezo.id]: { allapot: "kesz", url },
          }));
        } catch {
          if (!ervenyes) return;
          /**
           * A HIBA CSEMPENKENT ALL MEG, NEM A GALERIAT VISZI EL. Egy elhasalt
           * kep mellett a tobbi megjelenik, es a hianyt a csempe MONDJA KI --
           * egy ures negyzet ugyanugy nez ki, mint egy meg toltodo.
           */
          setAllapotok((elozo) => ({
            ...elozo,
            [kovetkezo.id]: { allapot: "hiba" },
          }));
        }
      }
    }

    void Promise.all(
      Array.from({ length: Math.min(EGYSZERRE, sor.length) }, futoszalag),
    );

    return () => {
      ervenyes = false;
      /**
       * A KESZITETT OBJEKTUM-URL-EKET VISSZA KELL VONNI, kulonben a bongeszo a
       * LAP ELETERE megtartja a blobot a memoriaban -- egy tiz fenykepes jegyen
       * tobb tiz megabajtot. A hiba nema: a kepek jok, a bongeszo lassul.
       *
       * A SAJAT FUTASA ALTAL KESZITETTEKET vonja vissza (`sajatUrlek`), nem egy
       * kozos listat: a takaritas AZ O futasahoz tartozik, es a kozben indult
       * kovetkezo futas URL-jei meg hasznalatban vannak.
       */
      for (const url of sajatUrlek) URL.revokeObjectURL(url);
    };
    // A LISTA AZONOSITOIRA FIGYELUNK, nem a tomb hivatkozasara: a szulo minden
    // ujrarajzolasnal uj tombot ad, es az minden korben ujratoltene a kepeket.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kulcs]);

  /** A nagyitott kepet az Escape is bezarja, nem csak a gomb. */
  useEffect(() => {
    if (!nagyitott) return;
    const kezelo = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNagyitott(null);
    };
    window.addEventListener("keydown", kezelo);
    return () => window.removeEventListener("keydown", kezelo);
  }, [nagyitott]);

  /**
   * A FELIRAT MENTESE -- ES AZ URES MEZO TORLEST JELENT.
   *
   * `null` megy le, nem ures string: a szerver ugyanezt a szabalyt mondja ki, es
   * ha a kliens ures stringet kuldene, a "nincs felirat" es a "szandekosan ures
   * felirat" ket allapota egyformanak tunne.
   *
   * A MEZO CSAK SIKER UTAN ZAR BE. Ha a hivas elbukik, a begepelt szoveg
   * OTTMARAD -- egy elveszett felirat ujra leirando, es a masodik nekifutas
   * rovidebb lenne, mint az elso. Ugyanaz a megfontolas, mint a jegy
   * lepteteseneel a megjegyzes-mezonel.
   */
  async function feliratMentese(item: T) {
    if (!onSaveCaption) return;
    setMentes(true);
    setFeliratHiba(null);
    try {
      const szoveg = piszkozat.trim();
      await onSaveCaption(item, szoveg ? szoveg : null);
      setSzerkesztett(null);
    } catch (cause) {
      setFeliratHiba(
        cause instanceof Error
          ? cause.message
          : "A felirat mentése nem sikerült.",
      );
    } finally {
      setMentes(false);
    }
  }

  if (items.length === 0)
    /* A HIANY IS ALLITAS: egy ures doboz betoltesi hibanak latszik, es a kezelo
       megvarja. Ez a mondat kimondja, hogy nincs mire varni. */
    return <p className="text-sm text-dusk-500">{emptyText}</p>;

  const nagyitottAllapot = nagyitott ? allapotok[nagyitott.id] : undefined;

  return (
    <div className="space-y-3">
      {kepek.length ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {kepek.map((item) => {
            const allapot = allapotok[item.id] ?? { allapot: "tolt" };
            // EGYSZER HIVJUK MEG, es nem ketszer a JSX-ben: a visszahivas a
            // HIVOE, tehat nem tudhatjuk, mit csinal mellette.
            const cimke = itemLabel?.(item) ?? null;
            const meta = `${cimke ? `${cimke} · ` : ""}${formatFileSize(
              item.sizeBytes,
            )} · ${formatDateTime(item.createdAt)}`;
            return (
              <li
                key={item.id}
                className="overflow-hidden rounded border text-sm"
              >
                {allapot.allapot === "kesz" ? (
                  <button
                    type="button"
                    className="block w-full"
                    aria-label={`${item.fileName} megnyitása teljes méretben`}
                    onClick={() => setNagyitott(item)}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={allapot.url}
                      alt={item.fileName}
                      className="h-32 w-full bg-dusk-100 object-cover"
                    />
                  </button>
                ) : (
                  <div className="flex h-32 w-full items-center justify-center bg-dusk-100 px-2 text-center text-xs text-dusk-500">
                    {allapot.allapot === "hiba"
                      ? "Ez a kép nem tölthető le. A fájl megvan, csak megjeleníteni nem tudjuk -- töltsd le."
                      : "Betöltés…"}
                  </div>
                )}
                <div className="space-y-1 px-2 py-2">
                  {/*
                    A FELIRAT A FAJLNEV FOLOTT ALL, es ez nem elrendezesi izles:
                    a felirat azt mondja meg, MIT LATUNK, a fajlnev csak azt,
                    hogy a telefon minek nevezte el. A kettobol az elso az, amit
                    a kezelo keres.
                  */}
                  {item.caption ? (
                    <p className="font-medium" title={item.caption}>
                      {item.caption}
                    </p>
                  ) : null}
                  <p
                    className={
                      item.caption
                        ? "truncate text-xs text-dusk-500"
                        : "truncate font-medium"
                    }
                    title={item.fileName}
                  >
                    {item.fileName}
                  </p>
                  {/*
                    A FAJTA A MERET ELE KERUL, egy sorban: kulon sorkent egy
                    negyedik szoveget vinne a csempere, es a csempe magassaga
                    a kepbol elvenne. A sorrend nem izles -- a fajta MONDJA
                    MEG, mit latunk, a meret csak leirja.

                    ES 2026-09-18 OTA `truncate` ALL RAJTA, UGYANUGY, MINT A
                    FAJLNEVEN. Enelkul a sor MINDEN SZOKOZNEL torhetett, es a
                    datum formatuma onmagaban NEGY szokozt tartalmaz
                    ("2026. 09. 18. 9:10") -- keskeny oszlopban ezert allt elo
                    egy HAT SOROS meret-sor egyetlen fenykep alatt.

                    A szoveg EGY valtozobol megy a tartalomba ES a `title`-be:
                    ket kulon kiiras elcsuszhatna, es a sugo mast mondana, mint
                    a lathato sor.
                  */}
                  <p className="truncate text-xs text-dusk-500" title={meta}>
                    {meta}
                  </p>
                  {onSaveCaption && szerkesztett === item.id ? (
                    <div className="space-y-1">
                      <label className="sr-only" htmlFor={`felirat-${item.id}`}>
                        Felirat
                      </label>
                      <Input
                        id={`felirat-${item.id}`}
                        value={piszkozat}
                        maxLength={500}
                        onChange={(event) => setPiszkozat(event.target.value)}
                        placeholder="Mit látunk a képen?"
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          disabled={mentes}
                          onClick={() => void feliratMentese(item)}
                        >
                          Mentés
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={mentes}
                          onClick={() => {
                            setSzerkesztett(null);
                            setFeliratHiba(null);
                          }}
                        >
                          Mégse
                        </Button>
                      </div>
                      {feliratHiba ? (
                        <p className="text-xs text-rose-600">{feliratHiba}</p>
                      ) : null}
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => onDownload(item)}
                      >
                        Letöltés
                      </Button>
                      {onSaveCaption ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setSzerkesztett(item.id);
                            setPiszkozat(item.caption ?? "");
                            setFeliratHiba(null);
                          }}
                        >
                          {item.caption ? "Felirat átírása" : "Felirat"}
                        </Button>
                      ) : null}
                      {onDelete ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => onDelete(item)}
                        >
                          Törlés
                        </Button>
                      ) : null}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {egyeb.length ? (
        <ul className="divide-y rounded border text-sm">
          {egyeb.map((item) => {
            const cimke = itemLabel?.(item) ?? null;
            return (
              <li
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-3 px-3 py-2"
              >
                <div>
                  <p className="font-medium">{item.fileName}</p>
                  <p className="text-xs text-dusk-500">
                    {cimke ? `${cimke} · ` : ""}
                    {formatFileSize(item.sizeBytes)} ·{" "}
                    {formatDateTime(item.createdAt)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => onDownload(item)}
                  >
                    Letöltés
                  </Button>
                  {onDelete ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => onDelete(item)}
                    >
                      Törlés
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {nagyitott && nagyitottAllapot?.allapot === "kesz" ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={nagyitott.fileName}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/80 p-4"
          onClick={() => setNagyitott(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={nagyitottAllapot.url}
            alt={nagyitott.fileName}
            className="max-h-[80vh] max-w-full object-contain"
            onClick={(event) => event.stopPropagation()}
          />
          <div className="flex items-center gap-3">
            <p className="text-sm text-white">{nagyitott.fileName}</p>
            <Button
              size="sm"
              variant="secondary"
              onClick={(event) => {
                event.stopPropagation();
                setNagyitott(null);
              }}
            >
              Bezárás
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
