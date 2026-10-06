import type { MessageStreamEvent } from "./types";

/**
 * AZ SSE-FOLYAM OLVASÁSA DARABONKÉNT (Üzenetek, kártya 51d7aba0).
 *
 * A telefonon nincs `EventSource`; a folyamot az `expo/fetch` adja darabokban,
 * és egy darab bárhol elvághat egy eseményt (a sor közepén is). Ez a függvény a
 * pufferből kiveszi a TELJES eseményeket (üres sorral lezártakat), és a maradékot
 * visszaadja a következő darabhoz.
 *
 * Csak az ismert eseményeket adja vissza; a `ping` életjel és a kommentsor
 * kimarad, egy hibás JSON pedig `resync` jelzés lesz (a hallgató újraolvas,
 * ahelyett hogy egy félreolvasott eseményből dolgozna).
 */
export type StreamSignal = MessageStreamEvent | { type: "resync" };

const KNOWN = new Set([
  "message.created",
  "conversation.created",
  "conversation.read",
  "conversation.deleted",
  "message.updated",
  "assistant.thinking",
]);

export function parseSseChunk(buffer: string): {
  signals: StreamSignal[];
  rest: string;
} {
  const normalized = buffer.replace(/\r\n?/g, "\n");
  const blocks = normalized.split("\n\n");
  const rest = blocks.pop() ?? "";
  const signals: StreamSignal[] = [];
  for (const block of blocks) {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
      if (field === "event") event = value;
      else if (field === "data") data.push(value);
    }
    if (!KNOWN.has(event)) continue;
    try {
      signals.push(JSON.parse(data.join("\n")) as MessageStreamEvent);
    } catch {
      signals.push({ type: "resync" });
    }
  }
  return { signals, rest };
}

/**
 * VISSZACSATLAKOZÁSI VÁRAKOZÁS: 1, 2, 4, 8, 16, majd legfeljebb 30 másodperc.
 * Egy sikeres kapcsolat után újra az elejéről indul.
 */
export function reconnectDelayMs(attempt: number): number {
  return Math.min(30_000, 1_000 * 2 ** Math.max(0, attempt));
}
