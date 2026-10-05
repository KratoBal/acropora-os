"use client";

import { Alert, Skeleton } from "@acropora/ui";
import {
  PilotBadge,
  PilotButton,
  PilotCard,
  PilotDialog,
  PilotThemeRoot,
} from "@acropora/ui";
import {
  plainTextToRichHtml,
  richHtmlForEmail,
  richHtmlToText,
  sanitizeRichHtml,
} from "@acropora/rich-text";
import {
  MAIL_TEMPLATE_EVENTS,
  WEBSHOP_MAIL_SAMPLE_FACTS,
  misplacedBlockVariables,
  renderMailTemplate,
  renderMailTemplateHtml,
  renderWebshopMail,
  splitTemplateVariables,
  unknownTemplateVariables,
  webshopMailTemplateOf,
  type MailTemplateGroup,
  type MailTemplateVariable,
  type WebshopRenderSteps,
} from "@acropora/types";
import {
  EmailRichEditor,
  type EmailRichEditorHandle,
} from "@acropora/ui/email-rich-editor";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import {
  MailImagePicker,
  useMailImages,
  withImageSources,
} from "@/components/settings/mail-image-picker";
import {
  mailTemplatesApi,
  type MailTemplateResponse,
  type MailTemplateState,
} from "@/lib/api/mail-templates";

/**
 * BEÁLLÍTÁSOK → LEVÉLSABLONOK, KÉT CSOPORTTAL (Figma 527:414, 2026-10-05).
 *
 * Szerviz: az OS saját levelei, ugyanúgy, mint eddig. Webshop: a webshop
 * ügyféllevelei, amiket 2026-10-05 óta az OS renderel (Balázs döntése, 20:11
 * UTC). A lap csak a TARTALMAT szerkeszti: hogy mikor megy ki egy levél, azt a
 * küldő oldal dönti el, itt semmi nem változtat rajta.
 *
 * === EZ A LAP NEM ÉLESÍTI A KÜLDÉST ===
 *
 * A szerviz-levelek küldése külön kapcsolón áll (`TICKET_MAIL_MODE`), a
 * webshopé a webshop oldalán (`ACROPORA_WEBSHOP_MAIL_RENDERER`).
 */

const GROUPS: readonly { id: MailTemplateGroup; label: string }[] = [
  { id: "SERVICE", label: "Szerviz" },
  { id: "WEBSHOP", label: "Webshop" },
];

/**
 * AZ ELŐNÉZET MINTA-ÉRTÉKEI A SZERVIZ-LEVELEKHEZ -- ÉS AZ ISMERETLEN NÉV IS KAP
 * HELYETTESÍTÉST. A kulcsokat a VÁLASZBAN érkező változó-lista adja, a táblázat
 * csak szebb mintaszöveget ad ahhoz, amit ismer. A webshop-levelek mintája a
 * közös csomag minta-tényeiből jön (`WEBSHOP_MAIL_SAMPLE_FACTS`).
 */
const MINTA: Readonly<Record<string, string>> = {
  cimzett: "Kiss Márta",
  jegyszam: "HJ-2026-001",
  jegy_targya: "Szivattyú zúg",
  jegy_leirasa: "Reggel óta hangos, és melegszik a motor.",
};

/**
 * A link-változók mintája a szervertől jön (`sampleLinks`): ugyanazzal a
 * függvénnyel és környezetből épül, mint a valódi levél. Üres érték is érvényes
 * minta: ha a szerveren nincs webcím, a valódi levélben is üres a link.
 */
function mintaErtekek(
  variables: readonly MailTemplateVariable[],
  sampleLinks: Readonly<Record<string, string>> = {},
): Record<string, string> {
  return Object.fromEntries(
    variables.map((v) => [
      v.name,
      sampleLinks[v.name] ?? MINTA[v.name] ?? `‹${v.name}›`,
    ]),
  );
}

/**
 * A SZOVEGES SABLON FORMAZOTT ALAKJA -- CSAK A SZERKESZTOBEN. A mar tarolt
 * szoveges sablonok betolteskor alakulnak at, adat-migracio nincs: a level
 * akkor lesz HTML, amikor valaki ezen a lapon ment.
 */
function formazott(
  szoveg: string,
  variables: readonly MailTemplateVariable[],
): string {
  return plainTextToRichHtml(szoveg, {
    variables: variables.map((v) => v.name),
  });
}

const alapTorzs = (
  template: MailTemplateResponse,
  variables: readonly MailTemplateVariable[],
) =>
  template.defaultTemplate.bodyHtml ??
  formazott(template.defaultTemplate.body, variables);

function linkNevek(variables: readonly MailTemplateVariable[]): string[] {
  return variables.filter((v) => v.kind === "link").map((v) => v.name);
}

/**
 * A WEBSHOP-LEVÉL ELŐNÉZETE UGYANAZT A FÜGGVÉNYT HÍVJA, AMIT A RENDER-VÉGPONT
 * (`renderWebshopMail`), ugyanezzel a négy lépéssel (`webshop-mail.render.ts`,
 * API). Így az előnézet nem mutathat mást, mint ami a vevőhöz megy.
 */
const WEBSHOP_STEPS: WebshopRenderSteps = {
  sanitize: (raw) => sanitizeRichHtml(raw),
  toText: (clean) => richHtmlToText(clean),
  plainToHtml: (text, variables) => plainTextToRichHtml(text, { variables }),
  forEmail: richHtmlForEmail,
};

/**
 * AZ ELONEZET KERETE. Az iframe `sandbox` attributuma URES: semmi nem futhat
 * benne. A keret a kuldes keretevel (`mailHtmlDocument`) azonos ertekeket
 * hasznal; a webshop-level sajat kerettel jon (`webshopMailDocument`).
 */
function elonezetDokumentum(html: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1f2937;margin:12px;">${html}</body></html>`;
}

/** „ma 18:42”, vagy a nap is, ha nem ma volt. Budapesti idő. */
function mentesIdeje(iso: string, most = new Date()): string {
  const nap = (d: Date) =>
    new Intl.DateTimeFormat("hu-HU", {
      timeZone: "Europe/Budapest",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  const ido = new Intl.DateTimeFormat("hu-HU", {
    timeZone: "Europe/Budapest",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
  return nap(new Date(iso)) === nap(most)
    ? `ma ${ido}`
    : `${nap(new Date(iso))} ${ido}`;
}

const esemenyekCsoportban = (group: MailTemplateGroup) =>
  MAIL_TEMPLATE_EVENTS.filter((e) => e.group === group);

/** Amit a megerősítés után el kell végezni: egy másik sablon vagy egy másik oldal. */
type Kilepes =
  | {
      readonly kind: "template";
      readonly group: MailTemplateGroup;
      readonly id: string;
    }
  | { readonly kind: "page"; readonly href: string };

export function MailTemplatePage() {
  const { session } = useAuth();
  const token = session?.token ?? "";

  const [group, setGroup] = useState<MailTemplateGroup>("SERVICE");
  const [esemenyId, setEsemenyId] = useState<string>(
    esemenyekCsoportban("SERVICE")[0]?.id ?? "",
  );
  const [allapotok, setAllapotok] = useState<
    readonly MailTemplateState[] | null
  >(null);
  const [dirty, setDirty] = useState(false);
  const [kilepes, setKilepes] = useState<Kilepes | null>(null);

  /*
    A LISTA ÁLLAPOTA (Alapértelmezett / Szerkesztett) EGY HÍVÁSBÓL JÖN. Ha nem
    tölthető be, a lista a jelvények nélkül áll: a szerkesztés ettől nem
    akad el, a jelvény csak tájékoztat.
  */
  const allapotBetoltes = useCallback(async () => {
    try {
      setAllapotok(await mailTemplatesApi.list(token));
    } catch {
      setAllapotok(null);
    }
  }, [token]);

  useEffect(() => {
    void allapotBetoltes();
  }, [allapotBetoltes]);

  /*
    NEM MENTETT MÓDOSÍTÁSNÁL A LAP ELHAGYÁSA KÉRDEZ. A böngésző saját kérdése
    az újratöltésre és a fül bezárására; a lapon belüli linkekre a sajátunk.
  */
  useEffect(() => {
    if (!dirty) return;
    const ujratoltes = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    const kattintas = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.("a[href]");
      if (!link || link.getAttribute("target") === "_blank") return;
      const href = link.getAttribute("href") ?? "";
      if (!href.startsWith("/")) return;
      event.preventDefault();
      event.stopPropagation();
      setKilepes({ kind: "page", href });
    };
    window.addEventListener("beforeunload", ujratoltes);
    document.addEventListener("click", kattintas, true);
    return () => {
      window.removeEventListener("beforeunload", ujratoltes);
      document.removeEventListener("click", kattintas, true);
    };
  }, [dirty]);

  const valt = (cel: Kilepes) => {
    if (cel.kind === "page") {
      window.location.assign(cel.href);
      return;
    }
    setGroup(cel.group);
    setEsemenyId(cel.id);
    setDirty(false);
  };

  const kerValtas = (cel: Kilepes) => {
    if (dirty) setKilepes(cel);
    else valt(cel);
  };

  const lista = esemenyekCsoportban(group);
  /* a template missing from a loaded list has no stored text: the default */
  const allapotOf = (id: string): MailTemplateState | null =>
    allapotok
      ? (allapotok.find((a) => a.id === id) ?? {
          id,
          source: "default",
          updatedAt: null,
        })
      : null;

  return (
    <PilotThemeRoot className="space-y-6">
      <header>
        <h1 className="text-[28px] font-semibold leading-9 text-pilot-grey-900">
          Levélsablonok
        </h1>
        <p className="mt-1 text-sm text-pilot-grey-600">
          Automatikus rendszerlevelek tartalma és előnézete egy helyen. A
          küldési szabályok nem változnak.
        </p>
      </header>

      <div
        role="tablist"
        aria-label="Sabloncsoport"
        className="inline-flex gap-0.5 rounded-lg bg-white p-1 ring-1 ring-pilot-grey-200"
      >
        {GROUPS.map((g) => (
          <button
            key={g.id}
            type="button"
            role="tab"
            aria-selected={group === g.id}
            onClick={() => {
              if (g.id === group) return;
              kerValtas({
                kind: "template",
                group: g.id,
                id: esemenyekCsoportban(g.id)[0]?.id ?? "",
              });
            }}
            className={`min-w-28 rounded-md px-4 py-2 text-left text-sm font-medium transition-colors ${
              group === g.id
                ? "bg-pilot-aqua-50 text-pilot-aqua-700"
                : "bg-transparent text-pilot-grey-600 hover:bg-pilot-grey-50"
            }`}
          >
            {g.label}
          </button>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-[192px_minmax(0,1fr)] xl:grid-cols-[264px_minmax(0,1fr)_minmax(0,1fr)]">
        <PilotCard className="p-4 md:row-span-2 xl:row-span-1">
          <h2 className="text-base font-semibold text-pilot-grey-900">
            {group === "WEBSHOP" ? "Webshop levelek" : "Szerviz levelek"}
          </h2>
          <p className="mt-0.5 text-xs text-pilot-grey-500">
            {group === "WEBSHOP"
              ? `${lista.length} ügyféllevél · szerkeszthető tartalom`
              : `${lista.length} sablon`}
          </p>
          <ul aria-label="Sablonok" className="mt-4 space-y-2.5">
            {lista.map((esemeny) => {
              const allapot = allapotOf(esemeny.id);
              const kivalasztott = esemeny.id === esemenyId;
              return (
                <li key={esemeny.id}>
                  <button
                    type="button"
                    aria-current={kivalasztott ? "true" : undefined}
                    onClick={() => {
                      if (!kivalasztott)
                        kerValtas({ kind: "template", group, id: esemeny.id });
                    }}
                    className={`block w-full rounded-lg p-3 text-left ring-1 transition-colors ${
                      kivalasztott
                        ? "bg-pilot-aqua-50 ring-pilot-aqua-500"
                        : "bg-white ring-pilot-grey-200 hover:bg-pilot-grey-50"
                    }`}
                  >
                    <span className="flex flex-wrap items-start justify-between gap-2">
                      <span className="text-[13px] font-semibold text-pilot-grey-900">
                        {esemeny.name}
                      </span>
                      {allapot ? (
                        <PilotBadge
                          variant={
                            allapot.source === "stored" ? "teal" : "grey"
                          }
                        >
                          {allapot.source === "stored"
                            ? "Szerkesztett"
                            : "Alapértelmezett"}
                        </PilotBadge>
                      ) : null}
                    </span>
                    <span className="mt-2 block text-xs text-pilot-grey-500">
                      {esemeny.description}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </PilotCard>

        <TemplateEditor
          key={esemenyId}
          token={token}
          esemenyId={esemenyId}
          group={group}
          allapot={allapotOf(esemenyId)}
          onDirtyChange={setDirty}
          onSaved={() => void allapotBetoltes()}
        />
      </div>

      {kilepes ? (
        <PilotDialog open onClose={() => setKilepes(null)}>
          <div
            role="alertdialog"
            aria-labelledby="nem-mentett-cim"
            className="p-5"
          >
            <h2
              id="nem-mentett-cim"
              className="text-sm font-semibold text-pilot-amber-700"
            >
              Nem mentett módosításaid vannak.
            </h2>
            <p className="mt-2 text-sm text-pilot-grey-600">
              Ha most kilépsz, a módosítások elvesznek.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <PilotButton variant="secondary" onClick={() => setKilepes(null)}>
                Maradok
              </PilotButton>
              <PilotButton
                variant="secondary"
                onClick={() => {
                  const cel = kilepes;
                  setKilepes(null);
                  if (cel) valt(cel);
                }}
              >
                Kilépés mentés nélkül
              </PilotButton>
            </div>
          </div>
        </PilotDialog>
      ) : null}
    </PilotThemeRoot>
  );
}

function TemplateEditor({
  token,
  esemenyId,
  group,
  allapot,
  onDirtyChange,
  onSaved,
}: {
  token: string;
  esemenyId: string;
  group: MailTemplateGroup;
  allapot: MailTemplateState | null;
  onDirtyChange: (dirty: boolean) => void;
  onSaved: () => void;
}) {
  const esemeny = MAIL_TEMPLATE_EVENTS.find((e) => e.id === esemenyId);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [template, setTemplate] = useState<MailTemplateResponse | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  /** Amit a szerver utoljára adott: ehhez mérjük, van-e nem mentett módosítás. */
  const [betoltott, setBetoltott] = useState<{
    subject: string;
    body: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [visszaallitas, setVisszaallitas] = useState(false);
  const [elonezetFul, setElonezetFul] = useState<"html" | "szoveg">("html");
  const szerkesztoRef = useRef<EmailRichEditorHandle | null>(null);
  const kepek = useMailImages(token);
  const [kepValaszto, setKepValaszto] = useState(false);

  /*
    HIBÁS VÁLASZ NEM ÍRJA FELÜL A SZERKESZTETT TARTALMAT (a prompt 17. pontja):
    egy sikertelen újraolvasás után a mezők maradnak, csak a hiba jelenik meg.
  */
  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setLoadError(null);
      try {
        const response = await mailTemplatesApi.read(token, esemenyId, {
          signal,
        });
        const torzs =
          response.bodyHtml ?? formazott(response.body, response.variables);
        setTemplate(response);
        setSubject(response.subject);
        setBody(torzs);
        setBetoltott({ subject: response.subject, body: torzs });
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
    [token, esemenyId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const dirty =
    betoltott !== null &&
    (subject !== betoltott.subject || body !== betoltott.body);
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  const variables = template?.variables ?? [];
  const blokkNevek = useMemo(
    () => variables.filter((v) => v.kind === "block").map((v) => v.name),
    [variables],
  );

  /** UGYANAZ a függvény fut itt, ami a szerver `PUT` ágán; a szerveré a döntő. */
  const ismeretlen = useMemo(() => {
    const hasznalhato = variables.map((v) => v.name);
    return [
      ...new Set([
        ...unknownTemplateVariables(subject, hasznalhato),
        ...unknownTemplateVariables(body, hasznalhato),
      ]),
    ];
  }, [subject, body, variables]);
  const kettevagott = useMemo(() => splitTemplateVariables(body), [body]);
  const rosszHelyenBlokk = useMemo(
    () => [
      ...new Set([
        ...misplacedBlockVariables(body, blokkNevek),
        ...blokkNevek.filter((n) => subject.includes(`{{${n}}}`)),
      ]),
    ],
    [body, subject, blokkNevek],
  );

  const szovegesTorzs = useMemo(
    () => richHtmlToText(body, { hrefPlaceholders: linkNevek(variables) }),
    [body, variables],
  );

  /*
    AZ ELŐNÉZET UGYANAZT A MOTORT HASZNÁLJA, AMIT A KÜLDÉS. Ismeretlen névnél
    a motor nem renderel, tehát az előnézet sem: pontosan az, ami küldéskor
    történne.
  */
  const webshopSablon = webshopMailTemplateOf(esemenyId);
  const elonezet = useMemo(():
    { ok: true; targy: string; html: string; text: string } | { ok: false } => {
    if (webshopSablon) {
      const mail = renderWebshopMail(
        { subject, body: szovegesTorzs, bodyHtml: body },
        WEBSHOP_MAIL_SAMPLE_FACTS[webshopSablon],
        WEBSHOP_STEPS,
      );
      return mail.ok
        ? { ok: true, targy: mail.subject, html: mail.html, text: mail.text }
        : { ok: false };
    }
    const ertekek = mintaErtekek(variables, template?.sampleLinks);
    const targy = renderMailTemplate(subject, ertekek);
    const html = renderMailTemplateHtml(body, ertekek);
    if (!targy.ok || !html.ok) return { ok: false };
    const tiszta = sanitizeRichHtml(html.text);
    return {
      ok: true,
      targy: targy.text,
      html: elonezetDokumentum(richHtmlForEmail(tiszta)),
      text: richHtmlToText(tiszta),
    };
  }, [webshopSablon, subject, body, szovegesTorzs, variables, template]);

  const beszur = (nev: string) => szerkesztoRef.current?.insertVariable(nev);

  /**
   * AZ ALAPÉRTELMEZÉS VISSZATÖLTÉSE -- MEGERŐSÍTÉS UTÁN, A SZERKESZTŐBE, NEM A
   * SZERVERRE. A mentés a szerkesztő döntése marad: aki visszatöltötte és
   * meggondolta, a Mentés nélkül elhagyja.
   */
  const visszatoltes = () => {
    if (!template) return;
    setSubject(template.defaultTemplate.subject);
    setBody(alapTorzs(template, variables));
    setVisszaallitas(false);
  };

  const mentes = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await mailTemplatesApi.save(token, esemenyId, {
        subject,
        body: szovegesTorzs,
        bodyHtml: body,
      });
      onSaved();
      await load();
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "A mentés nem sikerült.",
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading && !template)
    return (
      <PilotCard className="space-y-4 p-5">
        <div
          aria-busy="true"
          aria-label="Sablon betöltése"
          className="space-y-3"
        >
          <Skeleton className="h-5 w-1/2 bg-pilot-grey-100" />
          <Skeleton className="h-4 w-3/4 bg-pilot-grey-100" />
          <Skeleton className="h-24 w-full bg-pilot-grey-100" />
          <Skeleton className="h-4 w-1/3 bg-pilot-grey-100" />
        </div>
        <p className="text-right text-xs text-pilot-grey-500">Betöltés…</p>
      </PilotCard>
    );

  if (loadError && !template)
    return (
      <PilotCard className="p-5">
        <Alert
          variant="danger"
          title="Nem sikerült betölteni a levélsablonokat."
          description={`${loadError} Próbáld újra.`}
          action={
            <PilotButton variant="secondary" onClick={() => void load()}>
              Újrapróbálás
            </PilotButton>
          }
        />
      </PilotCard>
    );

  const valtozatlanAlap =
    template !== null &&
    subject === template.defaultTemplate.subject &&
    body === alapTorzs(template, variables);
  const hibak =
    ismeretlen.length + kettevagott.length + rosszHelyenBlokk.length;

  return (
    <>
      <PilotCard className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-pilot-grey-900">
              {esemeny?.name}
            </h2>
            <p className="mt-1 text-xs text-pilot-grey-500">
              Kiküldés: {esemeny?.description}
            </p>
          </div>
          {template ? (
            <PilotBadge
              variant={template.source === "stored" ? "teal" : "grey"}
            >
              {template.source === "stored"
                ? "Szerkesztett"
                : "Alapértelmezett"}
            </PilotBadge>
          ) : null}
        </div>

        {loadError ? (
          <div className="mt-4">
            <Alert
              variant="danger"
              title="Nem sikerült betölteni a levélsablonokat."
              description={`${loadError} A szerkesztőben álló szöveg nem módosult.`}
              action={
                <PilotButton variant="secondary" onClick={() => void load()}>
                  Újrapróbálás
                </PilotButton>
              }
            />
          </div>
        ) : null}

        <label className="mt-5 block space-y-1.5">
          <span className="text-xs font-medium text-pilot-grey-700">Tárgy</span>
          <input
            aria-label="Tárgy"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            className="w-full rounded-lg bg-white px-3 py-2.5 text-sm text-pilot-grey-900 ring-1 ring-pilot-grey-200 outline-none focus:ring-2 focus:ring-pilot-aqua-500"
          />
        </label>

        <div className="mt-5">
          <p className="text-xs font-medium text-pilot-grey-700">
            Beilleszthető változók
          </p>
          <p className="mt-0.5 text-xs text-pilot-grey-500">
            Csak ehhez a levélhez releváns mezők. Kattintásra a törzsbe kerül,
            oda, ahol a kurzor áll.
          </p>
          {/*
            A LISTA A VÁLASZBÓL JÖN, NEM ITTANI FELSOROLÁSBÓL: egy kézzel
            karbantartott lista az első új változónál kettéválna a motortól.
          */}
          <ul className="mt-2 flex flex-wrap gap-2">
            {variables.map((valtozo) => (
              <li key={valtozo.name}>
                <button
                  type="button"
                  title={valtozo.description}
                  onClick={() => beszur(valtozo.name)}
                  className={`inline-flex h-8 items-center rounded-md px-2.5 font-mono text-xs ring-1 transition-colors ${
                    valtozo.kind === "block"
                      ? "bg-pilot-grey-50 text-pilot-grey-700 ring-pilot-grey-300 hover:bg-pilot-grey-100"
                      : "bg-white text-pilot-grey-700 ring-pilot-grey-200 hover:bg-pilot-aqua-50"
                  }`}
                >
                  {`{{${valtozo.name}}}`}
                </button>
              </li>
            ))}
          </ul>
          {blokkNevek.length ? (
            <p className="mt-2 text-xs text-pilot-grey-500">
              A szürke mezők blokkok: a rendszer állítja össze őket a
              rendelésből, a belsejük nem szerkeszthető, csak a helyük.
              Mindegyik külön bekezdésben álljon.
            </p>
          ) : null}
        </div>

        <div className="mt-5 space-y-1.5">
          <span className="text-xs font-medium text-pilot-grey-700">Törzs</span>
          <EmailRichEditor
            ref={szerkesztoRef}
            aria-label="Törzs"
            value={body}
            onChange={setBody}
            variables={variables}
            onImageRequest={() => setKepValaszto((nyitva) => !nyitva)}
            resolveImageSrc={kepek.resolve}
          />
          {kepValaszto ? (
            <MailImagePicker
              images={kepek.images}
              sources={kepek.sources}
              error={kepek.error}
              upload={kepek.upload}
              onInsert={(kep) => szerkesztoRef.current?.insertImage(kep)}
              onClose={() => setKepValaszto(false)}
            />
          ) : null}
          <p className="text-xs text-pilot-grey-500">
            Formázott HTML és szöveges változat együtt mentődik.
          </p>
        </div>

        <div className="mt-4 space-y-3">
          {kettevagott.length ? (
            <Alert
              variant="danger"
              title="Kettévágott változó a sablonban"
              description={`${kettevagott.map((n) => `{{${n}}}`).join(", ")}: egy formázás a változó közepére került, ezért a levélben nyersen menne ki. Illeszd vissza egyben a változóchipet.`}
            />
          ) : null}
          {ismeretlen.length ? (
            <Alert
              variant="danger"
              title="Ismeretlen változó a sablonban"
              description={`${ismeretlen.map((n) => `{{${n}}}`).join(", ")}: ezeket a rendszer nem ismeri ennél a levélnél, ezért a levél nem menne ki.`}
            />
          ) : null}
          {rosszHelyenBlokk.length ? (
            <Alert
              variant="danger"
              title="A blokk csak külön bekezdésben állhat"
              description={`${rosszHelyenBlokk.map((n) => `{{${n}}}`).join(", ")}: tedd egy üres sorba, szöveg nélkül. A tárgyban blokk nem állhat.`}
            />
          ) : null}
          {saveError ? (
            <p role="alert" className="text-xs text-pilot-red-700">
              {saveError}
            </p>
          ) : null}

          <div
            role="status"
            className="rounded-lg bg-pilot-grey-50 px-4 py-3 text-xs text-pilot-grey-600 ring-1 ring-pilot-grey-200"
          >
            <p className="font-semibold text-pilot-grey-900">
              {template?.source === "stored"
                ? "Szerkesztett sablon"
                : "Alapértelmezett szöveg"}
            </p>
            <p className="mt-0.5">
              {[
                template?.source === "stored" && allapot?.updatedAt
                  ? `Utoljára mentve ${mentesIdeje(allapot.updatedAt)}`
                  : template?.source === "default"
                    ? "Ezt a szöveget még senki nem írta át"
                    : null,
                dirty ? "nem mentett módosítás" : null,
                hibak ? "validációs hiba" : "nincs validációs hiba",
              ]
                .filter((resz): resz is string => Boolean(resz))
                .map((resz, i) => (
                  <span key={resz}>
                    {i ? " · " : null}
                    <span>{resz}</span>
                  </span>
                ))}
            </p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          {/* A GOMB CSAK AKKOR ÁLL OTT, HA VAN MIT VISSZAÁLLÍTANI. */}
          {template && !valtozatlanAlap ? (
            <PilotButton
              variant="secondary"
              onClick={() => setVisszaallitas(true)}
              disabled={saving}
            >
              Alapértelmezés visszatöltése
            </PilotButton>
          ) : (
            <span />
          )}
          <PilotButton
            onClick={() => void mentes()}
            disabled={saving || hibak > 0 || !szovegesTorzs.trim()}
          >
            {saving ? "Mentés…" : "Mentés"}
          </PilotButton>
        </div>
        <p className="mt-3 text-xs text-pilot-grey-500">
          Az alapértelmezett szöveg bármikor visszaállítható.
        </p>
      </PilotCard>

      <PilotCard className="p-5 md:col-start-2 xl:col-start-auto">
        <h2 className="text-base font-semibold text-pilot-grey-900">
          Előnézet
        </h2>
        {/*
          A LEVÉL KÉT ALTERNATÍVÁT VISZ, ÉS MINDKETTŐ LÁTHATÓ: amelyik levelező
          nem tud HTML-t, az a szövegeset mutatja, és az is a vevőhöz megy.
        */}
        <div
          role="tablist"
          aria-label="Előnézet fajtája"
          className="mt-3 flex gap-1"
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
                  ? "rounded-md bg-pilot-aqua-50 px-3 py-1.5 text-xs font-medium text-pilot-aqua-700"
                  : "rounded-md bg-transparent px-3 py-1.5 text-xs text-pilot-grey-600 hover:bg-pilot-grey-100"
              }
            >
              {cimke}
            </button>
          ))}
        </div>
        <div className="mt-3">
          {elonezet.ok ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-pilot-grey-900">
                {elonezet.targy}
              </p>
              {elonezetFul === "html" ? (
                <iframe
                  title="A levél formázott előnézete"
                  sandbox=""
                  srcDoc={withImageSources(elonezet.html, kepek.sources)}
                  className="h-[560px] w-full rounded-lg bg-white ring-1 ring-pilot-grey-200"
                />
              ) : (
                <pre className="whitespace-pre-wrap rounded-lg bg-white p-3 text-xs text-pilot-grey-700 ring-1 ring-pilot-grey-200">
                  {elonezet.text}
                </pre>
              )}
            </div>
          ) : (
            <p className="text-xs text-pilot-red-700">
              Ismeretlen vagy rossz helyen álló változó miatt nincs előnézet: a
              küldéskor ugyanígy nem menne ki a levél.
            </p>
          )}
        </div>
        <p className="mt-3 rounded-lg bg-pilot-grey-50 px-3 py-2 text-xs text-pilot-grey-500">
          {group === "WEBSHOP"
            ? "Mintaadatok · a kiküldött levél ugyanígy renderelődik."
            : "Mintaadatok · ugyanazzal a behelyettesítéssel, amit a küldés használ."}
        </p>
      </PilotCard>

      {visszaallitas ? (
        <PilotDialog open onClose={() => setVisszaallitas(false)}>
          <div
            role="alertdialog"
            aria-labelledby="visszaallitas-cim"
            className="p-5"
          >
            <h2
              id="visszaallitas-cim"
              className="text-sm font-semibold text-pilot-grey-900"
            >
              Visszaállítod az alapértelmezett szöveget?
            </h2>
            <p className="mt-2 text-sm text-pilot-grey-600">
              A saját módosítások elvesznek. A művelet mentés után válik
              véglegessé.
            </p>
            <div className="mt-5 flex justify-between gap-2">
              <PilotButton
                variant="secondary"
                onClick={() => setVisszaallitas(false)}
              >
                Mégse
              </PilotButton>
              <PilotButton variant="danger" onClick={visszatoltes}>
                Visszaállítás
              </PilotButton>
            </div>
          </div>
        </PilotDialog>
      ) : null}
    </>
  );
}
