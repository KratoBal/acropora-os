import type {
  ArticleBodyInput,
  ArticleDetail,
  ArticleEditorData,
  ArticleRevisionDiff,
  ContentChannel,
  ContentDetail,
  ContentListResponse,
  ContentState,
  ContentViewerRole,
  ContentWaitingOnMeResponse,
  TeachingOutputBody,
  TeachingOutputDetail,
  TeachingOutputEditDetail,
  TeachingOutputEditSummary,
  TeachingOutputKind,
  TeachingOutputSummary,
  TeachingSourceEditorData,
  TeachingSourceInput,
  TeachingSourceListItem,
} from "@acropora/types";

import { API_PREFIX } from "./api-prefix";
import { ApiError, apiAuthHeaders, apiRequest } from "./client";

/** The file name the server gives in Content-Disposition, or the fallback. */
function dispositionFilename(header: string | null, fallback: string): string {
  const match = header?.match(/filename="([^"]+)"/);
  return match?.[1] ?? fallback;
}

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
   * MI VÁR RÁM, SZEREP-VÁLASZTÁS NÉLKÜL.
   *
   * A SZEREP NEM MEGY ÁT, ÉS EZ A LÉNYEG: a szerver a bejelentkezett
   * felhasználóból és a jogaiból számolja ki, mi vár rá. A `waiting` hívással
   * szemben itt nincs mit választani, és ezért nem is lehet rosszul választani.
   */
  waitingOnMe(token: string, signal?: AbortSignal) {
    return apiRequest<ContentWaitingOnMeResponse>(
      "/content/waiting-on-me",
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
   * EGY TÉTEL RÉSZLETESEN: a szöveg és a beszélgetés.
   *
   * A LISTA SZÁNDÉKOSAN NEM HORDOZZA EZEKET, és ez a hívás a párja: ami egy
   * sorból nem dönthető el, azt itt lehet elolvasni. Ugyanaz a `moves` mező jön
   * vele, mint a listával, tehát a nézetnek sincs saját szabálya arról, mit
   * lehet most lépni.
   */
  detail(token: string, id: string, signal?: AbortSignal) {
    return apiRequest<ContentDetail>(
      `/content/${encodeURIComponent(id)}`,
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
      revisionNote?: string;
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

  /**
   * EGY UJ TETEL FELVETELE A SORBA.
   *
   * A KEZDO ALLAPOT NEM MEGY AT, es ez szandekos: a szerver donti el, egy
   * helyen. Ha a kliens valaszthatna, a jovahagyasi kapu az elso kenyelmes
   * pillanatban megkerulheto lenne egy "mar kesz" allapottal.
   */
  /**
   * AZ OTLETEK ELOHELYE. Kulon lista, mert egy otlet SENKIRE nem var, tehat a
   * negy szerep-nezet egyikeben sincs helye.
   */
  ideas(token: string, signal?: AbortSignal) {
    return apiRequest<ContentListResponse>("/content/ideas", token, { signal });
  },

  /**
   * EGY OTLET FELJEGYZESE. Sajat vegpont, nem a `create` egy parametere: az
   * allapotot a kliens nem valaszthatja meg.
   */
  createIdea(token: string, input: { title: string; channel: ContentChannel }) {
    return apiRequest<{ id: string }>("/content/ideas", token, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  create(
    token: string,
    input: {
      title: string;
      channel: ContentChannel;
      body?: string;
      imageRequired?: boolean;
      plannedFor?: string;
    },
  ) {
    return apiRequest<{ id: string }>("/content", token, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  comment(token: string, id: string, body: string) {
    return apiRequest<{ id: string }>(
      `/content/${encodeURIComponent(id)}/comments`,
      token,
      { method: "POST", body: JSON.stringify({ body }) },
    );
  },

  /**
   * THE ARTICLE BODY with what its editor may use: the image hosts the save
   * cleans with, the taxa, and whether the body may change now.
   */
  article(token: string, id: string, signal?: AbortSignal) {
    return apiRequest<ArticleEditorData>(
      `/content/${encodeURIComponent(id)}/article`,
      token,
      { signal },
    );
  },

  /**
   * Two versions of the article compared: `from` and `to` are an approved
   * revision's id or "current" (the saved body being edited).
   */
  articleDiff(
    token: string,
    id: string,
    from: string,
    to: string,
    signal?: AbortSignal,
  ) {
    const query = new URLSearchParams({ from, to });
    return apiRequest<ArticleRevisionDiff>(
      `/content/${encodeURIComponent(id)}/article/diff?${query.toString()}`,
      token,
      { signal },
    );
  },

  /** Saving the body: the server cleans it, checks the links and the state. */
  saveArticle(token: string, id: string, input: ArticleBodyInput) {
    return apiRequest<{ article: ArticleDetail | null }>(
      `/content/${encodeURIComponent(id)}/article`,
      token,
      { method: "PUT", body: JSON.stringify(input) },
    );
  },

  /**
   * One image for an article, into the OS's own store (acrobot, msg 36320);
   * the answer is its public address, which the save keeps.
   */
  uploadArticleImage(token: string, id: string, file: File) {
    const form = new FormData();
    form.append("file", file);
    return apiRequest<{ id: string; url: string }>(
      `/content/${encodeURIComponent(id)}/article/images`,
      token,
      { method: "POST", body: form },
    );
  },

  /** The teaching sources with their outputs' states (T5.2, the source list). */
  teachingSources(token: string, signal?: AbortSignal) {
    return apiRequest<TeachingSourceListItem[]>(
      "/content/teaching-sources",
      token,
      { signal },
    );
  },

  /**
   * AN OKTATÓANYAG FORRÁSA (T5.2): the source, what its table and text say
   * about each other, and whether it may change now.
   */
  teachingSource(token: string, id: string, signal?: AbortSignal) {
    return apiRequest<TeachingSourceEditorData>(
      `/content/${encodeURIComponent(id)}/teaching-source`,
      token,
      { signal },
    );
  },

  saveTeachingSource(token: string, id: string, input: TeachingSourceInput) {
    return apiRequest<TeachingSourceEditorData>(
      `/content/${encodeURIComponent(id)}/teaching-source`,
      token,
      { method: "PUT", body: JSON.stringify(input) },
    );
  },

  teachingOutputs(token: string, id: string, signal?: AbortSignal) {
    return apiRequest<TeachingOutputSummary[]>(
      `/content/${encodeURIComponent(id)}/teaching-source/outputs`,
      token,
      { signal },
    );
  },

  /** An output built from the current source, not stored. */
  teachingOutputPreview(
    token: string,
    id: string,
    kind: TeachingOutputKind,
    signal?: AbortSignal,
  ) {
    return apiRequest<TeachingOutputBody>(
      `/content/${encodeURIComponent(id)}/teaching-source/outputs/preview?kind=${kind}`,
      token,
      { signal },
    );
  },

  generateTeachingOutput(token: string, id: string, kind: TeachingOutputKind) {
    return apiRequest<TeachingOutputDetail>(
      `/content/${encodeURIComponent(id)}/teaching-source/outputs`,
      token,
      { method: "POST", body: JSON.stringify({ kind }) },
    );
  },

  markTeachingOutputSent(
    token: string,
    id: string,
    outputId: string,
    input: { to: string; public: boolean },
  ) {
    return apiRequest<TeachingOutputDetail>(
      `/content/${encodeURIComponent(id)}/teaching-source/outputs/${encodeURIComponent(outputId)}/sent`,
      token,
      { method: "POST", body: JSON.stringify(input) },
    );
  },

  /** The output's file (PDF, PPTX or the narration as text), saved by the browser. */
  async downloadTeachingOutput(
    token: string,
    id: string,
    outputId: string,
  ): Promise<void> {
    const response = await fetch(
      `${API_PREFIX}/content/${encodeURIComponent(id)}/teaching-source/outputs/${encodeURIComponent(outputId)}/file`,
      { headers: apiAuthHeaders(token) },
    );
    if (!response.ok)
      throw new ApiError("A kimenet letöltése nem sikerült.", response.status);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = dispositionFilename(
      response.headers.get("Content-Disposition"),
      "oktatoanyag",
    );
    document.body.appendChild(link);
    link.click();
    link.remove();
    // delayed, as the other downloaders do: the download reads the URL
    // asynchronously, and some browsers abort it on a synchronous revoke
    // (barracuda on #2581)
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  },

  /** The edited copies of an output (the "differs from the source" mark). */
  teachingOutputEdits(
    token: string,
    id: string,
    outputId: string,
    signal?: AbortSignal,
  ) {
    return apiRequest<TeachingOutputEditSummary[]>(
      `/content/${encodeURIComponent(id)}/teaching-source/outputs/${encodeURIComponent(outputId)}/edits`,
      token,
      { signal },
    );
  },

  teachingOutputEdit(
    token: string,
    id: string,
    outputId: string,
    editId: string,
  ) {
    return apiRequest<TeachingOutputEditDetail>(
      `/content/${encodeURIComponent(id)}/teaching-source/outputs/${encodeURIComponent(outputId)}/edits/${encodeURIComponent(editId)}`,
      token,
    );
  },

  uploadTeachingOutputEdit(
    token: string,
    id: string,
    outputId: string,
    file: File,
  ) {
    const form = new FormData();
    form.append("file", file);
    return apiRequest<TeachingOutputEditDetail>(
      `/content/${encodeURIComponent(id)}/teaching-source/outputs/${encodeURIComponent(outputId)}/edits`,
      token,
      { method: "POST", body: form },
    );
  },

  decideTeachingOutputEdit(
    token: string,
    id: string,
    outputId: string,
    editId: string,
    decision: { toSource: boolean; note: string | null },
  ) {
    return apiRequest<TeachingOutputEditDetail>(
      `/content/${encodeURIComponent(id)}/teaching-source/outputs/${encodeURIComponent(outputId)}/edits/${encodeURIComponent(editId)}/decision`,
      token,
      { method: "POST", body: JSON.stringify(decision) },
    );
  },
};
