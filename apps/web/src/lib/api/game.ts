import type { GameOption, GameQuestionType } from "@acropora/types";

import { API_PREFIX } from "./api-prefix";
import { apiAuthHeaders, apiRequest } from "./client";

/** A heti kérdés a kezelőnek, a darabszámokkal (`GET /game/questions`; kártya 31445d0f). */
export interface GameQuestionView {
  id: string;
  week: string;
  type: GameQuestionType;
  prompt: string;
  options: GameOption[];
  acceptedAnswers: string[];
  opensAt: string;
  closesAt: string;
  /** A hét nyereménye (mind opcionális: a régi kérdéseknek nincs). */
  prizeName: string | null;
  prizeDescription: string | null;
  prizeImageId: string | null;
  entryCount: number;
  confirmedCount: number;
  candidateCount: number;
}

export interface GameQuestionInput {
  week: string;
  type: GameQuestionType;
  prompt: string;
  options: GameOption[];
  acceptedAnswers: string[];
  opensAt: string;
  closesAt: string;
  /** `null` vagy üres: törli; ha nincs megadva, a szerver meghagyja. */
  prizeName?: string | null;
  prizeDescription?: string | null;
  prizeImageId?: string | null;
}

/** Egy beküldés: `counts` = megerősített és helyes (a kezelő döntése, ha van, különben az automatikus). */
export interface GameEntryView {
  id: string;
  email: string;
  /** A beküldő neve; üres a név nélküli (régi) sorokon. */
  name: string | null;
  answer: string;
  autoCorrect: boolean;
  manualCorrect: boolean | null;
  manualAt: string | null;
  confirmedAt: string | null;
  createdAt: string;
  counts: boolean;
}

export interface GameDrawView {
  id: string;
  kind: "WEEKLY" | "CHRISTMAS";
  questionId: string | null;
  question: { week: string } | null;
  seed: string;
  candidates: { email: string; weight: number }[];
  winnerEmail: string | null;
  ticket: number | null;
  tickets: number;
  createdAt: string;
  /** Cím szerint a név (az utolsó beküldésé, amelyiknek van); ami nincs benne, annak nincs neve. */
  names: Record<string, string>;
}

/**
 * Az élő sorsolás oldal nézete (a szerver ezt adja, semmi mást): számok, a nyeremény, és sorsolás után CSAK a nyertes
 * rövidített neve és kitakart címe. Más játékos neve vagy címe ide soha nem kerül (az oldalt élő adásban mutatjuk).
 */
export interface GameLiveDrawView {
  kind: "WEEKLY" | "CHRISTMAS";
  questionId: string | null;
  week: string | null;
  prizeName: string | null;
  prizeImageId: string | null;
  candidates: number;
  tickets: number;
  /** miért nem indítható most a sorsolás, vagy null */
  blocked: string | null;
  drawn: {
    drawId: string;
    winnerName: string | null;
    winnerEmailMasked: string | null;
    ticket: number | null;
    tickets: number;
    drawnAt: string;
  } | null;
}

/** A feltöltött nyereménykép a kép-tárolóból (a kérdés az `id`-t őrzi). */
export interface GamePrizeImage {
  id: string;
  fileName: string;
  width: number;
  height: number;
}

export interface GameMailQueue {
  pending: number;
  sentToday: number;
  dailyCap: number;
  /** miért nem menne most levél (kapu, küldő, link-alap), vagy null */
  blocked: string | null;
  /** az utolsó elbukott küldés (ebben a folyamatban), vagy null */
  lastError: { at: string; reason: string } | null;
  /** a teszten: a megerősítő link levél nélkül is kérhető (JATEK_TEST_LINKS=on) */
  testLinks: boolean;
}

/**
 * AZ ADATTÖRLÉS ELŐNÉZETE (kártyák bc0ca668, jatek-level-torles): mikor esedékes, és mit tehet a küldő kulcsa a kiment
 * megerősítő levelek elküldött példányaival. Csak számok és állapot, cím soha.
 */
export interface GameErasurePreview {
  dueAt: string;
  due: boolean;
  waitingForGrandDraw: boolean;
  mail: {
    capability:
      | { kind: "DELETE" | "TRASH" | "SEND_ONLY" | "NOT_CONFIGURED" }
      | { kind: "ERROR"; code: string };
    /** be van-e kapcsolva a törlés (JATEK_ERASE_MAIL=on); kikapcsolva csak számol */
    enabled: boolean;
    /** a lezárt hetek még törlésre váró, nyilvántartott levelei */
    tracked: number;
    /** az utolsó ütemezett futás számai (a mért száraz futás a bekapcsolás előtt), vagy null */
    lastRun: {
      at: string;
      dryRun: boolean;
      tracked: number;
      legacy: number;
      removed: number;
      sentByDays: number;
    } | null;
  };
}

export interface GameDrawVerify {
  drawId: string;
  seed: string;
  winnerEmail: string | null;
  same: boolean;
}

/** A nyereményjáték kezelése (kártya 31445d0f): kérdések, beküldések, kézi döntés, sorsolás. */
export const gameApi = {
  questions(token: string) {
    return apiRequest<GameQuestionView[]>("/game/questions", token);
  },
  createQuestion(token: string, input: GameQuestionInput) {
    return apiRequest<GameQuestionView>("/game/questions", token, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  /** A nyeremény képe: a levélsablon-képek tárolójába kerül, az azonosítót a kérdés őrzi. */
  uploadPrizeImage(token: string, file: File) {
    const form = new FormData();
    form.append("file", file);
    return apiRequest<GamePrizeImage>("/game/prize-images", token, {
      method: "POST",
      body: form,
    });
  },
  /** A kép az űrlap előnézetéhez (hitelesített olvasás). */
  async prizeImageContent(token: string, id: string): Promise<Blob> {
    const response = await fetch(
      `${API_PREFIX}/game/prize-images/${encodeURIComponent(id)}/content`,
      { credentials: "same-origin", headers: apiAuthHeaders(token) },
    );
    if (!response.ok) throw new Error("A kép nem tölthető be.");
    return response.blob();
  },
  /** Egy meglévő kérdés javítása (a teljes űrlap megy; a beküldések helyességét a szerver újraszámolja). */
  updateQuestion(token: string, id: string, input: GameQuestionInput) {
    return apiRequest<GameQuestionView>(
      `/game/questions/${encodeURIComponent(id)}`,
      token,
      { method: "PUT", body: JSON.stringify(input) },
    );
  },
  entries(token: string, questionId: string) {
    return apiRequest<GameEntryView[]>(
      `/game/questions/${encodeURIComponent(questionId)}/entries`,
      token,
    );
  },
  decide(token: string, entryId: string, correct: boolean | null) {
    return apiRequest<unknown>(
      `/game/entries/${encodeURIComponent(entryId)}/decision`,
      token,
      { method: "PUT", body: JSON.stringify({ correct }) },
    );
  },
  draws(token: string) {
    return apiRequest<GameDrawView[]>("/game/draws", token);
  },
  draw(token: string, kind: "WEEKLY" | "CHRISTMAS", questionId?: string) {
    return apiRequest<GameDrawView>("/game/draws", token, {
      method: "POST",
      body: JSON.stringify({ kind, ...(questionId ? { questionId } : {}) }),
    });
  },
  /** A napi levél-plafon fölött várakozó megerősítő levelek (acrobot, 2026-11-05). */
  mailQueue(token: string) {
    return apiRequest<GameMailQueue>("/game/mail-queue", token);
  },
  sendQueued(token: string) {
    return apiRequest<GameMailQueue & { sent: number }>(
      "/game/mail-queue/send",
      token,
      { method: "POST" },
    );
  },
  /** Az adattörlés és a levéltörlés állapota (száraz előnézet, nem ír). */
  erasure(token: string) {
    return apiRequest<GameErasurePreview>("/game/erasure", token);
  },
  /** A megerősítő link levél nélkül, csak a teszten (JATEK_TEST_LINKS=on). */
  testLink(token: string, entryId: string) {
    return apiRequest<{ link: string }>(
      `/game/entries/${encodeURIComponent(entryId)}/test-link`,
      token,
      { method: "POST" },
    );
  },
  /** Az élő sorsolás oldal nézete: a szám, a nyeremény, és ha már volt sorsolás, annak az eredménye. */
  liveDraw(token: string, kind: "WEEKLY" | "CHRISTMAS", questionId?: string) {
    const query = new URLSearchParams({ kind });
    if (questionId) query.set("questionId", questionId);
    return apiRequest<GameLiveDrawView>(`/game/live-draw?${query}`, token);
  },
  /** A gomb: a meglévő sorsolás, hétenként egyszer; ismételt nyomásra a rögzített eredmény jön vissza. */
  runLiveDraw(
    token: string,
    kind: "WEEKLY" | "CHRISTMAS",
    questionId?: string,
  ) {
    return apiRequest<GameLiveDrawView>("/game/live-draw", token, {
      method: "POST",
      body: JSON.stringify(questionId ? { kind, questionId } : { kind }),
    });
  },
  verify(token: string, drawId: string) {
    return apiRequest<GameDrawVerify>(
      `/game/draws/${encodeURIComponent(drawId)}/verify`,
      token,
      { method: "POST" },
    );
  },
};
