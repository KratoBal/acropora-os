import {
  HttpException,
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import {
  SUTYERAK_USER_ID,
  type AuthenticatedUser,
  type MessageStreamEvent,
} from "@acropora/types";
import type { Subscription } from "rxjs";

import {
  ASSISTANT_ERROR,
  ASSISTANT_GATEWAY_TIMEOUT_MS,
  AssistantService,
} from "../assistant/assistant.service.js";
import { AssistantThinkingState } from "./assistant-thinking.state.js";
import {
  MESSAGE_EVENT_BUS,
  type MessageEventBus,
} from "./message-event-bus.js";
import {
  MessagesRepository,
  type MessagingUserRow,
} from "./messages.repository.js";
import {
  SUTYERAK_ATTACHMENT_ONLY,
  assistantReplyPlan,
} from "./messages.rules.js";
import { MessagesService } from "./messages.service.js";
import { SUTYERAK_INBOX_REDIRECT, SutyerakInbox } from "./sutyerak-inbox.js";

/** Az átjáró egy NDJSON-sora, amennyit a válaszhoz olvasunk belőle. */
type GatewayEvent =
  | { type: "thread"; threadId: string }
  | { type: "done"; answer: string }
  | { type: "error"; message?: string }
  | { type: string };

/**
 * Az átjáró válaszából a szál és a kész válasz (vagy a hiba). A szöveg-darabok
 * (`text`) kimaradnak: az Üzenetekbe a kész válasz kerül, egyben.
 */
export function readGatewayAnswer(body: string): {
  threadId: string | null;
  answer: string | null;
} {
  let threadId: string | null = null;
  let answer: string | null = null;
  for (const line of body.split("\n")) {
    if (!line.trim()) continue;
    let event: GatewayEvent;
    try {
      event = JSON.parse(line) as GatewayEvent;
    } catch {
      continue;
    }
    if (event.type === "thread" && "threadId" in event && event.threadId)
      threadId = event.threadId;
    if (event.type === "done" && "answer" in event && event.answer?.trim())
      answer = event.answer;
  }
  return { threadId, answer };
}

/**
 * SUTYERÁK AZ ÜZENETEKBEN (4. pont B; Balázs, 2026-10-06 08:06 UTC).
 *
 * Sutyerák tagja a beszélgetésnek, tehát a meglévő eseménybusz neki is hozza a
 * `message.created`-et: erre figyel, a küldés útjába nem kell beleszólni, és
 * a küldő nem vár rá. Ha a szabály szerint válaszol (`assistantReplyPlan`), az
 * átjárót a KÜLDŐ nevében és ASSISTANT_READONLY belépőjével hívja, ugyanazzal
 * a költségkerettel, mint a widget; a választ Sutyerák üzeneteként menti.
 *
 * Beszélgetésenként egyszerre egy válasz fut (a következő a sor végén indul),
 * mert az átjáró egy szálon egyszerre egy kérdést fogad (409).
 */
@Injectable()
export class MessagesAssistantService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MessagesAssistantService.name);
  private readonly subscriptions: Subscription[] = [];
  private readonly running = new Map<string, Promise<unknown>>();

  constructor(
    private readonly repository: MessagesRepository,
    private readonly messages: MessagesService,
    private readonly assistant: AssistantService,
    private readonly thinking: AssistantThinkingState,
    @Inject(MESSAGE_EVENT_BUS) private readonly bus: MessageEventBus,
    /** A senki által nem olvasott postafiók-fiókok (4. pont B, 6. tétel). */
    @Optional() private readonly inbox?: SutyerakInbox,
  ) {}

  onModuleInit(): void {
    this.subscriptions.push(
      this.bus
        .subscribe(SUTYERAK_USER_ID)
        .subscribe((event) => this.onEvent(event)),
    );
    for (const inboxId of this.inbox?.ids() ?? []) {
      this.subscriptions.push(
        this.bus
          .subscribe(inboxId)
          .subscribe((event) => this.onInboxEvent(inboxId, event)),
      );
    }
    // a már meglévő, megválaszolatlan beszélgetések egyszer megkapják a mondatot
    void this.redirectWaiting().catch((error: unknown) =>
      this.logger.warn(
        `Inbox redirect pass failed: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  }

  onModuleDestroy(): void {
    for (const subscription of this.subscriptions) subscription.unsubscribe();
  }

  private onInboxEvent(inboxId: string, event: MessageStreamEvent): void {
    if (event.type !== "message.created") return;
    void this.serial(event.conversationId, () =>
      this.redirect(inboxId, event.conversationId, event.messageId),
    ).catch((error: unknown) =>
      this.logger.warn(
        `Inbox redirect failed in ${event.conversationId}: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  }

  /**
   * A POSTAFIÓK-FIÓK EGY MONDATA (4. pont B, 6. tétel; a választás indoka: ez
   * hagyja a legkevesebb különutat). A fiók nem választható többé, és ha mégis
   * írnak neki (egy régi beszélgetésben), a SAJÁT nevében egyszer megmondja,
   * hogy nem olvas, és kit kérdezzenek. Ha az előző üzenet már ez a mondat
   * volt, nem ismétli. A visszatérés a teszteknek szól.
   */
  async redirect(
    inboxId: string,
    conversationId: string,
    messageId: string,
  ): Promise<"SKIPPED" | "REDIRECTED"> {
    const [row] = await this.repository.messagesByIds([messageId]);
    if (!row || row.senderUserId === inboxId || row.deletedAt !== null)
      return "SKIPPED";
    if (row.type === "SYSTEM") return "SKIPPED";
    const { rows } = await this.repository.messagesPage({
      conversationId,
      before: null,
      limit: 2,
    });
    const previous = rows.find((m) => m.id !== messageId);
    if (
      previous?.senderUserId === inboxId &&
      previous.text === SUTYERAK_INBOX_REDIRECT
    )
      return "SKIPPED";
    await this.messages.postAs(
      inboxId,
      conversationId,
      SUTYERAK_INBOX_REDIRECT,
    );
    return "REDIRECTED";
  }

  /**
   * INDULÁSKOR egyszer: minden beszélgetés, ahol egy postafiók-fiók tag, és az
   * utolsó üzenet nem tőle jött (vagyis valaki írt neki, és nem kapott
   * választ), megkapja a mondatot. Ugyanaz a szabály, mint fent, tehát egy
   * újraindítás nem ismétli.
   */
  async redirectWaiting(): Promise<number> {
    let sent = 0;
    for (const inboxId of this.inbox?.ids() ?? []) {
      for (const conversation of await this.repository.conversationsOf(
        inboxId,
      )) {
        if (!conversation.lastMessageId) continue;
        const outcome = await this.serial(conversation.id, () =>
          this.redirect(inboxId, conversation.id, conversation.lastMessageId!),
        );
        if (outcome === "REDIRECTED") sent++;
      }
    }
    return sent;
  }

  private onEvent(event: MessageStreamEvent): void {
    if (event.type !== "message.created") return;
    void this.serial(event.conversationId, () =>
      this.handle(event.conversationId, event.messageId),
    ).catch((error: unknown) =>
      this.logger.error(
        `Sutyerák could not answer message ${event.messageId}: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  }

  /** Beszélgetésenként egyszerre egy válasz. */
  private serial<T>(
    conversationId: string,
    work: () => Promise<T>,
  ): Promise<T> {
    const previous = this.running.get(conversationId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(work);
    this.running.set(conversationId, next);
    void next
      .catch(() => undefined)
      .finally(() => {
        if (this.running.get(conversationId) === next)
          this.running.delete(conversationId);
      });
    return next;
  }

  /** Egy új üzenet: válaszol-e, és ha igen, mit. A visszatérés a teszteknek szól. */
  async handle(
    conversationId: string,
    messageId: string,
  ): Promise<"SKIPPED" | "ANSWERED" | "ATTACHMENT_ONLY" | "FAILED"> {
    const [row] = await this.repository.messagesByIds([messageId]);
    const conversation = await this.repository.conversation(conversationId);
    if (!row || !conversation) return "SKIPPED";
    const plan = assistantReplyPlan({
      assistantUserId: SUTYERAK_USER_ID,
      senderUserId: row.senderUserId,
      conversationType: conversation.type,
      activeMemberIds: conversation.members.map((m) => m.userId),
      type: row.type,
      text: row.text,
      attachmentCount: row.attachments.length,
      deleted: row.deletedAt !== null,
    });
    if (!plan) return "SKIPPED";
    const sender = conversation.members.find(
      (m) => m.userId === row.senderUserId,
    )?.user;
    // a küldő jogával dolgozik: akinek nem elérhető (partner, nincs a próbán), annak nem válaszol
    if (!sender?.isActive || !this.assistant.availableTo(asUser(sender)))
      return "SKIPPED";
    if (plan.kind === "ATTACHMENT_ONLY") {
      await this.messages.postAsAssistant(
        conversationId,
        SUTYERAK_ATTACHMENT_ONLY,
        "GATEWAY",
      );
      return "ATTACHMENT_ONLY";
    }

    const members = conversation.members.map((m) => m.userId);
    this.thinking.start(conversationId);
    this.bus.publish(members, {
      type: "assistant.thinking",
      conversationId,
      active: true,
    });
    try {
      const answer = await this.ask(
        asUser(sender),
        conversationId,
        plan.question,
        plan.group,
      );
      await this.messages.postAsAssistant(
        conversationId,
        answer ?? ASSISTANT_ERROR,
        "GATEWAY",
      );
      return answer ? "ANSWERED" : "FAILED";
    } catch (error) {
      // a korlát (429) a saját mondatával megy, minden más hiba a közös mondattal
      const text =
        error instanceof HttpException && error.getStatus() === 429
          ? error.message
          : ASSISTANT_ERROR;
      this.logger.warn(
        `Sutyerák failed in ${conversationId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      await this.messages.postAsAssistant(conversationId, text, "GATEWAY");
      return "FAILED";
    } finally {
      this.thinking.stop(conversationId);
      this.bus.publish(members, {
        type: "assistant.thinking",
        conversationId,
        active: false,
      });
    }
  }

  /**
   * Az átjáró hívása a kérdező szálán. Ha a szál már nem az övé vagy elveszett
   * (403), egyszer újra próbál szál nélkül, mint a widget. A válasz `null`, ha
   * az átjáró nem adott kész választ.
   */
  private async ask(
    sender: AuthenticatedUser,
    conversationId: string,
    question: string,
    group: boolean,
  ): Promise<string | null> {
    const context = {
      page: "/uzenetek",
      conversationId,
      audience: group ? "group" : "direct",
    };
    let threadId = await this.repository.assistantThread(
      conversationId,
      sender.id,
    );
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await this.assistant.askOnBehalf(
        sender,
        { question, ...(threadId ? { threadId } : {}), context },
        AbortSignal.timeout(ASSISTANT_GATEWAY_TIMEOUT_MS),
      );
      if (response.status === 403 && threadId) {
        await response.body?.cancel();
        await this.repository.dropAssistantThread(conversationId, sender.id);
        threadId = null;
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        return null;
      }
      const read = readGatewayAnswer(await response.text());
      if (read.threadId && read.threadId !== threadId)
        await this.repository.saveAssistantThread(
          conversationId,
          sender.id,
          read.threadId,
        );
      return read.answer;
    }
    return null;
  }
}

/** A tag sora a hívás alakjára: a belépő és a próba-szabály ennyit néz. */
function asUser(row: MessagingUserRow): AuthenticatedUser {
  return {
    id: row.id,
    email: "",
    displayName: row.displayName,
    nickname: row.nickname ?? null,
    role: row.role,
    avatarUrl: row.avatarUrl,
    customerId: row.customerId,
    supplierId: row.supplierId,
  };
}
