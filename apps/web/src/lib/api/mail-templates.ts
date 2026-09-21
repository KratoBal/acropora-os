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
   * AZ ALAPÉRTELMEZÉS MINDIG ITT VAN, AKKOR IS, HA MÁR MENTETTEK.
   *
   * A `subject` és a `body` a HATÁLYOS szöveget hordozza (tárolt vagy
   * alapértelmezett); ez a mező a kódban állót, mindig. Enélkül az első mentés
   * után nem lenne mihez visszatérni -- a szöveg ott állna a szerveren, és
   * semmi nem adná oda.
   */
  defaultTemplate: { subject: string; body: string };
  /**
   * A VÁLTOZÓK A VÁLASZBAN JÖNNEK, NEM A KLIENS LISTÁJÁBÓL.
   *
   * A felület ezt rajzolja ki a szerkesztő mellé. Egy kézzel karbantartott
   * lista az első új változónál kettéválna a motortól, és a szerkesztő olyat
   * gépelne be, amit a motor nem ismer.
   */
  variables: readonly MailTemplateVariable[];
}

export const mailTemplatesApi = {
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
    input: { subject: string; body: string },
  ): Promise<{ ok: true }> {
    return apiRequest<{ ok: true }>(
      `/notifications/mail-templates/${encodeURIComponent(id)}`,
      token,
      { method: "PUT", body: JSON.stringify(input) },
    );
  },
};
