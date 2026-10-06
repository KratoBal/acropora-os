import type { StreamSignal } from "./sse";
import type {
  ConversationListItem,
  ConversationPerson,
  MessageItem,
} from "./types";

/**
 * SUTYERÁK AZ ÜZENETEKBEN, A TELEFONON (4. pont, B; szerződés:
 * agents/murena/megosztas/sutyerak-4-pont-B-vegpontok.md, nautilus elfogadta).
 * A döntések itt állnak, tiszta függvényként; a képernyők csak meghívják őket.
 */

/** Sutyerák válasza, amit acrobot adott (B/5): a feladó neve helyén. */
export const SUTYERAK_VIA_ACROBOT = "Sutyerák, Acrobot válaszával";

/** A kollégaválasztóban a szerepkör helyén. */
export const SUTYERAK_PICKER_LABEL = "Segéd, kérdezd bármiről";

export function isAssistant(person: Pick<ConversationPerson, "kind">): boolean {
  return person.kind === "assistant";
}

/** A dolgozó és Sutyerák kettes beszélgetése: a másik tag ő. */
export function isAssistantConversation(
  item: Pick<ConversationListItem, "type" | "members">,
): boolean {
  return (
    item.type === "DIRECT" &&
    item.members.length === 1 &&
    isAssistant(item.members[0]!)
  );
}

/** Tag-e Sutyerák: csak ilyen beszélgetésnél kell a „gondolkodik” állapot. */
export function hasAssistant(
  item: Pick<ConversationListItem, "members">,
): boolean {
  return item.members.some(isAssistant);
}

/** Sutyerák a kollégaválasztó elején, a többiek az API sorrendjében. */
export function assistantFirst<T extends Pick<ConversationPerson, "kind">>(
  people: T[],
): T[] {
  return [
    ...people.filter(isAssistant),
    ...people.filter((p) => !isAssistant(p)),
  ];
}

/**
 * A buborék feje: az acrobot adta válaszon a jelölés (kettes beszélgetésben
 * is), különben csoportban a más által küldött üzenet feladója.
 */
export function bubbleSender(
  message: Pick<MessageItem, "senderName" | "assistant">,
  group: boolean,
  own: boolean,
): string | null {
  if (message.assistant?.viaAcrobot) return SUTYERAK_VIA_ACROBOT;
  return group && !own ? message.senderName : null;
}

/** A „gondolkodik” állapot a következő jelzés után, CSAK a saját beszélgetés eseményére. */
export function nextThinking(
  current: boolean,
  signal: StreamSignal,
  conversationId: string,
): boolean {
  if (signal.type !== "assistant.thinking") return current;
  return signal.conversationId === conversationId ? signal.active : current;
}

export interface AssistantSpan {
  text: string;
  bold: boolean;
}
export type AssistantBlock =
  | { kind: "paragraph"; spans: AssistantSpan[] }
  | { kind: "list"; ordered: boolean; items: AssistantSpan[][] }
  | { kind: "table"; header: AssistantSpan[][]; rows: AssistantSpan[][][] };

function spans(text: string): AssistantSpan[] {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .filter((part) => part !== "")
    .map((part) =>
      part.startsWith("**") && part.endsWith("**") && part.length > 4
        ? { text: part.slice(2, -2), bold: true }
        : { text: part, bold: false },
    );
}

const LIST_ITEM = /^\s*([-*]|\d+\.)\s/;

/**
 * Sutyerák Markdownja blokkokra, a webes `AssistantMarkdown` szabályaival
 * (félkövér, felsorolás, táblázat). Csak szöveg jön ki: a telefon `Text`-ként
 * rajzolja, HTML vagy kép nem kerülhet bele.
 */
export function assistantBlocks(text: string): AssistantBlock[] {
  const lines = text.split("\n");
  const blocks: AssistantBlock[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.includes("|") && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] ?? "")) {
      const cells = (row: string) =>
        row
          .replace(/^\s*\||\|\s*$/g, "")
          .split("|")
          .map((cell) => spans(cell.trim()));
      const header = cells(line);
      i += 2;
      const rows: AssistantSpan[][][] = [];
      while (i < lines.length && lines[i]!.includes("|"))
        rows.push(cells(lines[i++]!));
      i--;
      blocks.push({ kind: "table", header, rows });
    } else if (LIST_ITEM.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: AssistantSpan[][] = [];
      while (i < lines.length && LIST_ITEM.test(lines[i]!))
        items.push(spans(lines[i++]!.replace(LIST_ITEM, "")));
      i--;
      blocks.push({ kind: "list", ordered, items });
    } else if (line.trim()) {
      blocks.push({ kind: "paragraph", spans: spans(line) });
    }
  }
  return blocks;
}
