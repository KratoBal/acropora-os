import type { MailTemplateVariable } from "@acropora/types";

import { apiRequest } from "./client";

/**
 * A LEVÉL-SABLON KLIENSE.
 *
 * MA EGYETLEN AZONOSÍTÓ LÉTEZIK, és a szerver ezt ki is mondja: bármi másra
 * `404`-et ad (`mail-template.controller.ts`). A konstans ezért itt áll, nem a
 * hívó felületén -- így a lap nem egy begépelt szöveggel hivatkozik rá.
 */
export const WORKSHEET_SIGNED_TEMPLATE = "WORKSHEET_SIGNED";

/**
 * A `source` MEZŐ NEM RÉSZLET, ÉS EZÉRT VAN A TÍPUSBAN.
 *
 * Az első mentés előtt a szerver a KÓDBAN álló alapértelmezést adja vissza,
 * ugyanabban az alakban, mint egy tárolt sablont. A két eset a szövegből NEM
 * különböztethető meg -- egyedül ez a mező mondja meg, hogy amit a szerkesztő
 * olvas, azt még senki nem írta.
 *
 * A felületnek ezt KI KELL MONDANIA, nem elrejtenie: aki nem tudja, azt hiszi,
 * hogy ezt a szöveget valaki már jóváhagyta.
 */
export interface MailTemplateResponse {
  id: string;
  source: "stored" | "default";
  subject: string;
  body: string;
  /**
   * A FORMAZOTT TORZS, vagy `null`, ha a sablon (meg) szoveges. `null` eseten a
   * szerkeszto a `body`-t alakitja at -- a szerver nem tarol atalakitott
   * valtozatot, amig senki nem ment.
   */
  bodyHtml: string | null;
  /**
   * AZ ALAPÉRTELMEZÉS MINDIG ITT VAN, AKKOR IS, HA MÁR MENTETTEK.
   *
   * A `subject` és a `body` a HATÁLYOS szöveget hordozza (tárolt vagy
   * alapértelmezett); ez a mező a kódban állót, mindig. Enélkül az első mentés
   * után nem lenne mihez visszatérni -- a szöveg ott állna a szerveren, és
   * semmi nem adná oda.
   */
  defaultTemplate: { subject: string; body: string; bodyHtml?: string };
  /**
   * A link-valtozok mintaja az elonezethez: a szerver a valodi level webcimevel
   * es utvonalaval epiti (2026-09-28). Ures ertek: a szerveren nincs webcim, a
   * valodi levelben is ures lesz.
   */
  sampleLinks: Readonly<Record<string, string>>;
  /**
   * A VÁLTOZÓK A VÁLASZBAN JÖNNEK, NEM A KLIENS LISTÁJÁBÓL.
   *
   * A felület ezt rajzolja ki a szerkesztő mellé. Egy kézzel karbantartott
   * lista az első új változónál kettéválna a motortól, és a szerkesztő olyat
   * gépelne be, amit a motor nem ismer.
   */
  variables: readonly MailTemplateVariable[];
}

/** One row of the template list: whether its text is stored, and since when. */
export interface MailTemplateState {
  id: string;
  source: "stored" | "default";
  updatedAt: string | null;
}

export const mailTemplatesApi = {
  list(token: string, options: { signal?: AbortSignal } = {}) {
    return apiRequest<MailTemplateState[]>(
      "/notifications/mail-templates",
      token,
      { signal: options.signal },
    );
  },

  read(token: string, id: string, options: { signal?: AbortSignal } = {}) {
    return apiRequest<MailTemplateResponse>(
      `/notifications/mail-templates/${encodeURIComponent(id)}`,
      token,
      { signal: options.signal },
    );
  },

  /**
   * A MENTÉS A SZERVEREN IS ÁTMEGY AZ ISMERETLEN-VÁLTOZÓ KAPUN.
   *
   * A lap ugyanezt a kaput futtatja szerkesztés közben (`unknownTemplateVariables`,
   * `@acropora/types`), de a kettő NEM két szabály két helyen: UGYANAZ a
   * függvény, tehát nem tud elcsúszni. A szerveré a döntő, a lapé csak előbb szól.
   */
  save(
    token: string,
    id: string,
    input: { subject: string; body: string; bodyHtml?: string | null },
  ): Promise<{ ok: true }> {
    return apiRequest<{ ok: true }>(
      `/notifications/mail-templates/${encodeURIComponent(id)}`,
      token,
      { method: "PUT", body: JSON.stringify(input) },
    );
  },
};
