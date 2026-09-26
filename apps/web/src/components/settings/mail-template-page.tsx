"use client";

import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  Select,
} from "@acropora/ui";
import {
  plainTextToRichHtml,
  richHtmlToText,
  sanitizeRichHtml,
} from "@acropora/rich-text";
import {
  MAIL_TEMPLATE_EVENTS,
  renderMailTemplate,
  renderMailTemplateHtml,
  splitTemplateVariables,
  unknownTemplateVariables,
  type MailTemplateVariable,
} from "@acropora/types";
import {
  RichTextEditor,
  type RichTextEditorHandle,
} from "@acropora/ui/rich-text-editor";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import {
  mailTemplatesApi,
  type MailTemplateResponse,
} from "@/lib/api/mail-templates";

/**
 * A LEVÉL-SABLON SZERKESZTŐJE.
 *
 * Balázs döntése, 2026-09-21 14:07:09 UTC: „a szerkeszto oldal elobb." A kérdés
 * az volt, élesítsük-e most a levélküldést -- akkor az első levél a KÓDBA ÍRT
 * alapértelmezett szöveggel menne ki, átírhatatlanul.
 *
 * === EZ A LAP NEM ÉLESÍTI A KÜLDÉST ===
 *
 * A küldés külön kapcsolón áll (`TICKET_MAIL_MODE`), és annak a kinyitása külön
 * lépés, külön engedéllyel. Ez a lap csak azt dönti el, MI lesz a levélben, ha
 * egyszer megy.
 *
 * === MA EGYETLEN SABLON LÉTEZIK, ÉS EZT KIMONDJUK ===
 *
 * A szerver bármi másra `404`-et ad. Ezért itt nincs lista-felület: egy
 * egyelemű lista azt ígérné, hogy majd több lesz, és a szerkesztőt egy
 * fölösleges kattintással kezdené.
 */

/**
 * AZ ELŐNÉZET MINTA-ÉRTÉKEI -- ÉS AZ ISMERETLEN NÉV IS KAP HELYETTESÍTÉST.
 *
 * A kulcsokat NEM ez a táblázat adja, hanem a VÁLASZBAN érkező változó-lista:
 * a táblázat csak szebb mintaszöveget ad ahhoz, amit ismer. Így egy holnap
 * felvett ötödik változó nem töri el az előnézetet, csak a saját nevét mutatja
 * -- egy kézzel karbantartott kulcs-lista ugyanott „ismeretlen változó" hibát
 * adna egy tökéletesen helyes sablonra.
 */
const MINTA: Readonly<Record<string, string>> = {
  cimzett: "Kiss Márta",
  jegyszam: "HJ-2026-001",
  jegy_targya: "Szivattyú zúg",
  jegy_leirasa: "Reggel óta hangos, és melegszik a motor.",
  jegy_linkje: "https://os.acropora.hu/szerviz/hibajegyek/HJ-2026-001",
};

function mintaErtekek(
  variables: readonly MailTemplateVariable[],
): Record<string, string> {
  return Object.fromEntries(
    variables.map((v) => [v.name, MINTA[v.name] ?? `‹${v.name}›`]),
  );
}

/**
 * A SZOVEGES SABLON FORMAZOTT ALAKJA -- CSAK A SZERKESZTOBEN.
 *
 * 2026-09-26 ota a torzs formazott (Balazs kerese). A mar tarolt sablonok
 * szovegesek, es adat-migracio NINCS: itt alakulnak at, betolteskor. A level
 * akkor lesz HTML, amikor valaki ezen a lapon MENT; addig a szerver a regi
 * szoveges levelet kuldi, bajtra valtozatlanul.
 */
function formazott(
  szoveg: string,
  variables: readonly MailTemplateVariable[],
): string {
  return plainTextToRichHtml(szoveg, {
    variables: variables.map((v) => v.name),
  });
}

function linkNevek(variables: readonly MailTemplateVariable[]): string[] {
  return variables.filter((v) => v.kind === "link").map((v) => v.name);
}

/**
 * AZ ELONEZET KERETE. Az iframe `sandbox` attributuma URES: semmi nem futhat
 * benne, akkor sem, ha a tisztito egyszer atengedne valamit. A keret betutipusa
 * a kuldes kereteevel (`mailHtmlDocument`, API) azonos ertekeket hasznal.
 */
function elonezetDokumentum(html: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1f2937;margin:12px;">${html}</body></html>`;
}

export function MailTemplatePage() {
  const { session } = useAuth();
  const token = session?.token ?? "";

  /**
   * MELYIK ESEMENY SABLONJAT SZERKESZTJUK.
   *
   * 2026-09-22-ig egyetlen esemeny letezett, es a lap bedrotozta. Balazs tobb
   * sablont kert; a lista a KOZOS csomagbol jon (`MAIL_TEMPLATE_EVENTS`),
   * ugyanabbol, amit a vegpont is kerdez -- egy felveheto nev, amire semmi nem
   * kuld, pont az a fajta elcsuszas, amit ez elkerul.
   */
  const [esemenyId, setEsemenyId] = useState<string>(
    MAIL_TEMPLATE_EVENTS[0]?.id ?? "",
  );
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [template, setTemplate] = useState<MailTemplateResponse | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [elonezetFul, setElonezetFul] = useState<"html" | "szoveg">("html");
  const szerkesztoRef = useRef<RichTextEditorHandle | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setLoadError(null);
      try {
        const response = await mailTemplatesApi.read(token, esemenyId, {
          signal,
        });
        setTemplate(response);
        setSubject(response.subject);
        setBody(
          response.bodyHtml ?? formazott(response.body, response.variables),
        );
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        setLoadError(
          error instanceof Error
            ? error.message
            : "A sablon betöltése nem sikerült.",
        );
      } finally {
        setLoading(false);
      }
    },
    // A VALASZTOTT ESEMENY IS FUGGOSEG: enelkul a valaszto atallna, a lapon
    // viszont a REGI sablon maradna -- es a mentes a MASIK esemenyre irna.
    [token, esemenyId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const variables = template?.variables ?? [];

  /**
   * AZ ISMERETLEN VÁLTOZÓ SZERKESZTÉS KÖZBEN DERÜL KI (acrobot 3. kikötése).
   *
   * UGYANAZ a függvény fut itt, ami a szerver `PUT` ágán -- nem egy szabály két
   * helyen, hanem EGY függvény két hívóhellyel. A szerveré a döntő; ez csak
   * előbb szól, mielőtt bárki elmenti.
   */
  const ismeretlen = useMemo(
    () => [
      ...new Set([
        ...unknownTemplateVariables(subject),
        ...unknownTemplateVariables(body),
      ]),
    ],
    [subject, body],
  );

  /**
   * A FORMAZAS ALTAL KETTEVAGOTT VALTOZO. A szerkeszto a valtozot atomkent
   * kezeli, tehat onnan ritkan jon ilyen -- de egy beillesztett, reszben
   * formazott szoveg hozhat. A szerver menteskor ugyanezt kerdezi, es 400-at ad.
   */
  const kettevagott = useMemo(() => splitTemplateVariables(body), [body]);

  /** A szoveges valtozat: ez megy a HTML melle `text/plain`-kent. */
  const szovegesTorzs = useMemo(
    () => richHtmlToText(body, { hrefPlaceholders: linkNevek(variables) }),
    [body, variables],
  );

  /**
   * AZ ELŐNÉZET UGYANAZT A MOTORT HASZNÁLJA, AMIT A KÜLDÉS (2. kikötés).
   *
   * Nem hasonlót: a `renderMailTemplate` UGYANAZ a függvény, amit a szerver hív
   * kiküldéskor. Ezért költözött a `@acropora/types` alá. Két külön
   * behelyettesítés azt jelentené, hogy az előnézet HAZUDHAT -- és épp az
   * előnézet az egyetlen dolog, amiben bízni lehet, mielőtt levél megy ki.
   *
   * ÉS AZ ELUTASÍTÁST IS ÖRÖKLI: ismeretlen névnél a motor NEM renderel, tehát
   * az előnézet sem mutat semmit. Ez nem hiányosság, hanem pontosan az, ami
   * küldéskor történne.
   */
  const elonezet = useMemo(() => {
    const ertekek = mintaErtekek(variables);
    /*
      A FORMAZOTT ELONEZET PONTOSAN A KULDES LEPESEIT JARJA BE (`renderMailBody`,
      API): escape-elt behelyettesites, UTANA tisztitas, a szoveg a tiszta
      HTML-bol. A tisztito itt link-helyorzot NEM enged -- kuldeskor sem enged.
    */
    const html = renderMailTemplateHtml(body, ertekek);
    const tiszta = html.ok ? sanitizeRichHtml(html.text) : null;
    return {
      targy: renderMailTemplate(subject, ertekek),
      torzs:
        tiszta === null ? null : { html: tiszta, text: richHtmlToText(tiszta) },
    };
  }, [subject, body, variables]);

  /*
    A VALTOZO A SZERKESZTO KURZORAHOZ KERUL, ATOMKENT. A kurzor utana marad, a
    kovetkezo beszuras tehat mogeje kerul, nem bele.
  */
  const beszur = (nev: string) => szerkesztoRef.current?.insertVariable(nev);

  /**
   * AZ ALAPERTELMEZES VISSZATOLTESE -- A SZERKESZTOBE, NEM A SZERVERRE.
   *
   * A gomb NEM ment. Kitolti a ket mezot a kodban allo szoveggel, es onnantol
   * ugyanaz tortenik, mint barmelyik kezi szerkesztesnel: a szerkeszto latja,
   * mit fog menteni, es o nyomja meg a Mentest.
   *
   * MIERT NEM MENT AZONNAL: egy gomb, ami egy kattintasra felulirja a ma
   * hatalyos sablont, ugyanaz a fajta nema muvelet, mint amit ez a kartya
   * javit -- csak forditva. Igy a lepes visszavonhato: aki megnyomta es
   * meggondolta, ujratolti a lapot.
   *
   * AMI EZUTAN IS IGAZ MARAD, ES KI KELL MONDANI: mentes utan a `source`
   * "stored" marad, nem "default". Ez NEM hiba: a sor tenyleg letezik, es
   * tenyleg valaki irta -- csak epp az alapertelmezes szovegevel. A `source`
   * arrol szol, KI irta, nem arrol, MI all benne.
   */
  const alapertelmezesVisszatoltese = () => {
    if (!template) return;
    setSubject(template.defaultTemplate.subject);
    setBody(formazott(template.defaultTemplate.body, variables));
    setSaved(false);
  };

  const mentes = async () => {
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      /*
        A HTML ES A SZOVEGES VETULETE EGYUTT MEGY. A szerver a `body`-t a
        HTML-bol UJRA eloallitja (az a donto); itt azert kell, mert a mezo
        kotelezo, es egy regi szerver a szoveget tarolna.
      */
      await mailTemplatesApi.save(token, esemenyId, {
        subject,
        body: szovegesTorzs,
        bodyHtml: body,
      });
      setSaved(true);
      /*
        ÚJRAOLVASSUK, ÉS NEM A HELYI ÁLLAPOTOT ÍRJUK ÁT. A `source` mező az első
        mentés után `stored`-ra vált, és ezt a szerver mondja meg -- egy helyi
        `setSource("stored")` ugyanazt állítaná, de akkor is, ha a mentés
        valójában máshova került.
      */
      await load();
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "A mentés nem sikerült.",
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading)
    return <p className="text-sm text-dusk-600">Sablon betöltése…</p>;

  if (loadError)
    return (
      <Alert
        variant="danger"
        title="A sablon nem tölthető be"
        description={loadError}
        action={
          <Button variant="secondary" onClick={() => void load()}>
            Újra
          </Button>
        }
      />
    );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-dusk-900">Levélsablonok</h1>
        {/*
          A LAP KORABBAN AZT ALLITOTTA, hogy „ma ez az egyetlen automatikus
          levél". Ez MAR AKKOR SEM VOLT IGAZ, amikor leirtak: a munkalap
          alairasa is automatikusan kuld, emberi lepes nelkul
          (`worksheets.service.ts`, a `notifyWorksheetSigned` hivasa a
          dontesnel). 2026-09-22 ota ketto van, nem egy.

          A MONDAT EZERT A VALASZTOTT ESEMENY SAJAT LEIRASABOL JON, nem egy
          allando szovegbol: egy „ma ez az egyetlen" alaku allitas a kovetkezo
          esemennyel automatikusan elavul, es senki nem kap rola jelzest.
        */}
        <label className="mt-3 block max-w-md space-y-1">
          <span className="text-sm font-medium text-dusk-700">Esemény</span>
          <Select
            aria-label="Esemény"
            value={esemenyId}
            onChange={(event) => setEsemenyId(event.target.value)}
          >
            {MAIL_TEMPLATE_EVENTS.map((esemeny) => (
              <option key={esemeny.id} value={esemeny.id}>
                {esemeny.name}
              </option>
            ))}
          </Select>
        </label>
        <p className="mt-2 text-sm text-dusk-600">
          {MAIL_TEMPLATE_EVENTS.find((esemeny) => esemeny.id === esemenyId)
            ?.description ?? ""}
        </p>
      </div>

      {/*
        AZ ELSŐ MENTÉS ELŐTT KIMONDJUK, HOGY EZT A SZÖVEGET MÉG SENKI NEM ÍRTA.
        A szerver ugyanabban az alakban adja vissza a kódban álló
        alapértelmezést, mint egy tárolt sablont -- a kettő a szövegből nem
        különböztethető meg, és aki nem tudja, azt hiszi, valaki már jóváhagyta.
      */}
      {template?.source === "default" ? (
        <Alert
          title="Ezt a szöveget még senki nem írta át"
          description="A kódban álló alapértelmezés látszik. Az első mentéssel lesz belőle saját szöveg."
        />
      ) : null}

      {kettevagott.length ? (
        <Alert
          variant="danger"
          title="Kettévágott változó a sablonban"
          description={`${kettevagott.map((n) => `{{${n}}}`).join(", ")} — egy formázás a változó közepére került, ezért a levélben nyersen menne ki. Töröld, és illeszd be újra a jobb oldali listából.`}
        />
      ) : null}

      {ismeretlen.length ? (
        <Alert
          variant="danger"
          title="Ismeretlen változó a sablonban"
          description={`${ismeretlen.map((n) => `{{${n}}}`).join(", ")} — ezeket a rendszer nem ismeri, ezért a levél nem menne ki. Használd az alábbi változók valamelyikét.`}
        />
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-dusk-900">A levél</h2>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-dusk-700">Tárgy</span>
              <input
                aria-label="Tárgy"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                className="w-full rounded-lg border border-dusk-200 bg-white px-3 py-2 text-sm text-dusk-900 shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
              />
            </label>
            <div className="space-y-1">
              <span className="text-xs font-medium text-dusk-700">Törzs</span>
              <RichTextEditor
                ref={szerkesztoRef}
                aria-label="Törzs"
                value={body}
                onChange={setBody}
                variables={variables}
              />
            </div>

            {saveError ? (
              <p role="alert" className="text-xs text-rose-600">
                {saveError}
              </p>
            ) : null}
            {saved && !saveError ? (
              <p className="text-xs text-emerald-700">A sablon elmentve.</p>
            ) : null}

            <div className="flex items-center gap-3">
              {/*
                A GOMB CSAK AKKOR ALL OTT, HA VAN MIT VISSZAALLITANI.

                Ha a szerkesztoben eppen az alapertelmezes all, a gomb nem
                valtoztatna semmit -- egy gomb, ami nem csinal semmit, azt
                igeri, hogy a mezoben mas all, mint ami.
              */}
              {template &&
              (subject !== template.defaultTemplate.subject ||
                body !==
                  formazott(template.defaultTemplate.body, variables)) ? (
                <Button
                  variant="secondary"
                  onClick={alapertelmezesVisszatoltese}
                  disabled={saving}
                >
                  Alapértelmezés visszatöltése
                </Button>
              ) : null}
              <Button
                onClick={() => void mentes()}
                disabled={
                  saving ||
                  ismeretlen.length > 0 ||
                  kettevagott.length > 0 ||
                  !szovegesTorzs.trim()
                }
              >
                {saving ? "Mentés…" : "Mentés"}
              </Button>
              {/*
                A HOSSZ-KORLÁTOT NEM ÍRJUK LE ITT MÉG EGYSZER. A tárgy és a
                törzs felső határa a szerver DTO-jában áll; ha ide is beírnánk
                egy számot, a kettő egyszer elcsúszna, és a felület olyat
                tiltana vagy engedne, amit a szerver nem. Túllépésnél a szerver
                üzenete jelenik meg a mentés alatt, és az megnevezi a határt.
              */}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-dusk-900">
                Beilleszthető változók
              </h2>
            </CardHeader>
            <CardContent>
              {/*
                A LISTA A VÁLASZBÓL JÖN, NEM ITTANI FELSOROLÁSBÓL (1. kikötés).
                Egy kézzel karbantartott lista az első új változónál kettéválna
                a motortól, és a felület olyat kínálna, ami nem létezik.
              */}
              <ul className="space-y-2">
                {variables.map((valtozo) => (
                  <li key={valtozo.name}>
                    <button
                      type="button"
                      onClick={() => beszur(valtozo.name)}
                      className="block w-full rounded-md border border-dusk-200 px-3 py-2 text-left transition hover:border-brand-500 hover:bg-dusk-50"
                    >
                      <span className="block font-mono text-xs text-dusk-900">
                        {`{{${valtozo.name}}}`}
                      </span>
                      <span className="block text-xs text-dusk-500">
                        {valtozo.description}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-dusk-500">
                Kattintásra a törzsbe kerül, oda, ahol a kurzor áll.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-dusk-900">Előnézet</h2>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-xs text-dusk-500">
                Minta-adatokkal, ugyanazzal a behelyettesítéssel, amit a küldés
                használ.
              </p>
              {elonezet.targy.ok && elonezet.torzs ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-dusk-900">
                    {elonezet.targy.text}
                  </p>
                  {/*
                    A LEVEL KET ALTERNATIVAT VISZ, ES MINDKETTO LATHATO. A
                    levelezok tobbsege a formazottat mutatja, de amelyik nem
                    tud HTML-t, az a szovegeset -- es az is a vevohoz megy.
                  */}
                  <div
                    role="tablist"
                    aria-label="Előnézet fajtája"
                    className="flex gap-1"
                  >
                    {(
                      [
                        ["html", "Formázott"],
                        ["szoveg", "Szöveges"],
                      ] as const
                    ).map(([kulcs, cimke]) => (
                      <button
                        key={kulcs}
                        type="button"
                        role="tab"
                        aria-selected={elonezetFul === kulcs}
                        onClick={() => setElonezetFul(kulcs)}
                        className={
                          elonezetFul === kulcs
                            ? "rounded-md bg-brand-50 px-2 py-1 text-xs font-medium text-brand-700"
                            : "rounded-md px-2 py-1 text-xs text-dusk-600 hover:bg-dusk-100"
                        }
                      >
                        {cimke}
                      </button>
                    ))}
                  </div>
                  {elonezetFul === "html" ? (
                    <iframe
                      title="A levél formázott előnézete"
                      sandbox=""
                      srcDoc={elonezetDokumentum(elonezet.torzs.html)}
                      className="h-72 w-full rounded-md border border-dusk-100 bg-white"
                    />
                  ) : (
                    <pre className="whitespace-pre-wrap text-xs text-dusk-700">
                      {elonezet.torzs.text}
                    </pre>
                  )}
                </div>
              ) : (
                <p className="text-xs text-rose-600">
                  Ismeretlen változó miatt nincs előnézet — küldéskor ugyanígy
                  nem menne ki a levél.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
