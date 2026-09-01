import type {
  ContentListResponse,
  ContentState,
  ContentViewerRole,
} from "@acropora/types";

import { apiRequest } from "./client";

export const contentApi = {
  /**
   * AMI RÁM VÁR. Ez a lista alapértelmezett nézete, és Balázs kérésének
   * fordítása: „minden felkerul ami rank var".
   *
   * A SZEREP A HÍVÓTÓL JÖN, nem a szerverről: ugyanaz az ember lehet szerző az
   * egyik tételen és jóváhagyó a másikon, tehát a kérdés mindig az, hogy MELYIK
   * szemével nézzük.
   */
  waiting(token: string, role: ContentViewerRole, signal?: AbortSignal) {
    return apiRequest<ContentListResponse>(
      `/content/waiting?role=${role}`,
      token,
      { signal },
    );
  },

  /**
   * AMI KÉPRE VÁR. Külön hívás, nem a `waiting` egyik szűrője: a kép a
   * szövegtől független feltétel, és ma NÉGY kész szövegű poszt áll pontosan
   * itt, 2026-08-18 óta.
   */
  waitingForImage(token: string, signal?: AbortSignal) {
    return apiRequest<ContentListResponse>(
      "/content/waiting-for-image",
      token,
      { signal },
    );
  },

  /**
   * EGY LÉPÉS. A `from` NEM felesleges: a hívó kimondja, MILYEN ÁLLAPOTBAN
   * LÁTTA a tételt, amikor döntött, és ha közben elmozdult, hibát kap ahelyett,
   * hogy csendben felülírná valaki más döntését.
   *
   * A VÉGPONTOT A SZERVER VÁLASZA DÖNTI EL, NEM EZ A FÁJL. A sorral együtt
   * érkezik, hogy egy lépés jóváhagyói-e (`requiresApproval`); a hívó ezt adja
   * tovább, és nem tart saját listát arról, mi számít annak. Ha holnap egy másik
   * lépés válik jóváhagyóvá, itt semmit nem kell átírni.
   *
   * A JOG ATTÓL MÉG A SZERVERÉ: ez az elágazás a helyes URL-t választja ki, nem
   * a jogot dönti el. Aki jóváhagyói lépést kér jóváhagyói jog nélkül, `403`-at
   * kap akkor is, ha valahogy a másik úton jönne be.
   */
  move(
    token: string,
    id: string,
    input: {
      from: ContentState;
      to: ContentState;
      requiresApproval: boolean;
      discardReason?: string;
    },
  ) {
    const { requiresApproval, ...body } = input;
    const init = { method: "POST", body: JSON.stringify(body) };

    // A KÉT CÍM KÜLÖN VAN KIÍRVA, NEM EGY SABLONBÓL. Egy közös
    // `/content/${id}/${path}` alak rövidebb, de az útvonal-őrző
    // (`mobile-api-routes.spec.ts`) MINDKÉT behelyettesítést paraméterré
    // fordítja, és `content/:param/:param`-ot keres a szerveren -- olyan
    // útvonal pedig nincs. A piros jogos volt: abból a sorból az OLVASÓ sem
    // tudta megmondani, melyik két végpontot hívjuk.
    return requiresApproval
      ? apiRequest<{ ok: true }>(
          `/content/${encodeURIComponent(id)}/approve-move`,
          token,
          init,
        )
      : apiRequest<{ ok: true }>(
          `/content/${encodeURIComponent(id)}/move`,
          token,
          init,
        );
  },

  comment(token: string, id: string, body: string) {
    return apiRequest<{ id: string }>(
      `/content/${encodeURIComponent(id)}/comments`,
      token,
      { method: "POST", body: JSON.stringify({ body }) },
    );
  },
};
