"use client";

import { Alert, Button, Card, CardContent, CardHeader } from "@acropora/ui";
import {
  renderMailTemplate,
  unknownTemplateVariables,
  type MailTemplateVariable,
} from "@acropora/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import {
  mailTemplatesApi,
  WORKSHEET_SIGNED_TEMPLATE,
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
};

function mintaErtekek(
  variables: readonly MailTemplateVariable[],
): Record<string, string> {
  return Object.fromEntries(
    variables.map((v) => [v.name, MINTA[v.name] ?? `‹${v.name}›`]),
  );
}

export function MailTemplatePage() {
  const { session } = useAuth();
  const token = session?.token ?? "";

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [template, setTemplate] = useState<MailTemplateResponse | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setLoadError(null);
      try {
        const response = await mailTemplatesApi.read(
          token,
          WORKSHEET_SIGNED_TEMPLATE,
          { signal },
        );
        setTemplate(response);
        setSubject(response.subject);
        setBody(response.body);
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
    [token],
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
    return {
      targy: renderMailTemplate(subject, ertekek),
      torzs: renderMailTemplate(body, ertekek),
    };
  }, [subject, body, variables]);

  const beszur = (nev: string) => {
    const mezo = bodyRef.current;
    const jel = `{{${nev}}}`;
    if (!mezo) {
      setBody((elozo) => elozo + jel);
      return;
    }
    const start = mezo.selectionStart ?? body.length;
    const end = mezo.selectionEnd ?? start;
    setBody(body.slice(0, start) + jel + body.slice(end));
    /*
      A KURZOR A BESZÚRT JEL UTÁN ÁLL MEG. Enélkül a következő beszúrás
      ugyanoda kerülne, és a szerkesztő két változót kapna egymásba írva.
    */
    queueMicrotask(() => {
      mezo.focus();
      mezo.setSelectionRange(start + jel.length, start + jel.length);
    });
  };

  const mentes = async () => {
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      await mailTemplatesApi.save(token, WORKSHEET_SIGNED_TEMPLATE, {
        subject,
        body,
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
        <h1 className="text-xl font-semibold text-dusk-900">Levélsablon</h1>
        <p className="mt-1 text-sm text-dusk-600">
          Ez a szöveg megy ki a hibajegy bejelentőjének, amikor a jegyhez
          tartozó munkalapot aláírják. Ma ez az egyetlen automatikus levél.
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
            <label className="block space-y-1">
              <span className="text-xs font-medium text-dusk-700">Törzs</span>
              <textarea
                aria-label="Törzs"
                ref={bodyRef}
                rows={12}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                className="w-full rounded-lg border border-dusk-200 bg-white px-3 py-2 font-mono text-sm text-dusk-900 shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
              />
            </label>

            {saveError ? (
              <p role="alert" className="text-xs text-rose-600">
                {saveError}
              </p>
            ) : null}
            {saved && !saveError ? (
              <p className="text-xs text-emerald-700">A sablon elmentve.</p>
            ) : null}

            <div className="flex items-center gap-3">
              <Button
                onClick={() => void mentes()}
                disabled={saving || ismeretlen.length > 0}
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
              {elonezet.targy.ok && elonezet.torzs.ok ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-dusk-900">
                    {elonezet.targy.text}
                  </p>
                  <pre className="whitespace-pre-wrap text-xs text-dusk-700">
                    {elonezet.torzs.text}
                  </pre>
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
