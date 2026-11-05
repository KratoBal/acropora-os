import type { GameOption, GameQuestionType } from "@acropora/types";

import { apiRequest } from "./client";

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
}

/** Egy beküldés: `counts` = megerősített és helyes (a kezelő döntése, ha van, különben az automatikus). */
export interface GameEntryView {
  id: string;
  email: string;
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
}

export interface GameMailQueue {
  pending: number;
  sentToday: number;
  dailyCap: number;
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
  verify(token: string, drawId: string) {
    return apiRequest<GameDrawVerify>(
      `/game/draws/${encodeURIComponent(drawId)}/verify`,
      token,
      { method: "POST" },
    );
  },
};
