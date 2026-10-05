import { Injectable } from "@nestjs/common";
import type { MessageStreamEvent } from "@acropora/types";
import { Observable, Subject, filter, map } from "rxjs";

/**
 * AZ ÜZENET-ESEMÉNYEK SZÉTSZÓRÁSA (kártya 51d7aba0, a terv 2.3 pontja).
 *
 * INTERFÉSZ MÖGÖTT, mert ma egy API-konténer fut, és a memóriabeli megvalósítás
 * elég. Ha valaha több példány lesz, egy Redis pub/sub megvalósítás lép a helyére
 * ugyanezzel a két metódussal, és se a szolgáltatás, se a végpont nem változik.
 *
 * AZ ESEMÉNY CSAK AZONOSÍTÓT VISZ, szöveget nem: a kliens REST-en olvassa a
 * tartalmat, a tagság-ellenőrzés mögött. Így a folyam nem lesz második olvasási
 * út, amit külön kellene őrizni.
 */
export interface MessageEventBus {
  publish(userIds: readonly string[], event: MessageStreamEvent): void;
  subscribe(userId: string): Observable<MessageStreamEvent>;
}

export const MESSAGE_EVENT_BUS = Symbol("MessageEventBus");

@Injectable()
export class InMemoryMessageEventBus implements MessageEventBus {
  private readonly events = new Subject<{
    userId: string;
    event: MessageStreamEvent;
  }>();

  publish(userIds: readonly string[], event: MessageStreamEvent): void {
    for (const userId of new Set(userIds)) this.events.next({ userId, event });
  }

  subscribe(userId: string): Observable<MessageStreamEvent> {
    return this.events.pipe(
      filter((delivery) => delivery.userId === userId),
      map((delivery) => delivery.event),
    );
  }
}
