import { Injectable } from "@nestjs/common";
import { prisma, type Prisma } from "@acropora/database";

import type { ContentState } from "./content-state.js";

/**
 * A LISTA MEZŐI, NEVESÍTVE.
 *
 * A `body` SZÁNDÉKOSAN HIÁNYZIK: egy lista sosem mutatja a teljes szöveget, egy
 * `include` viszont minden skalár mezőt visszahozna. Ugyanaz a döntés, mint az
 * eszköz-dokumentumoknál a `content` oszloppal, és ugyanabból az okból: ami egy
 * listában nem látszik, azt nem is kell lekérdezni.
 */
const contentListSelect = {
  id: true,
  title: true,
  channel: true,
  state: true,
  imageRequired: true,
  imageAttachedAt: true,
  authorId: true,
  reviewerId: true,
  plannedFor: true,
  scheduledFor: true,
  scheduleAnchoredAt: true,
  sentAt: true,
  externalUrl: true,
  updatedAt: true,
} satisfies Prisma.ContentItemSelect;

@Injectable()
export class ContentRepository {
  list(where: Prisma.ContentItemWhereInput) {
    return prisma.contentItem.findMany({
      where,
      select: contentListSelect,
      // A TERVEZETT DÁTUM SZERINT, ÉS A DÁTUM NÉLKÜLIEK A VÉGÉN. A naptár
      // nézet ezt a sorrendet kívánja; a `nulls: "last"` nélkül a dátum
      // nélküli ötletek kerülnének előre, épp azok, amikre senki nem vár.
      orderBy: [
        { plannedFor: { sort: "asc", nulls: "last" } },
        { updatedAt: "desc" },
      ],
    });
  }

  detail(id: string) {
    return prisma.contentItem.findUnique({
      where: { id },
      include: {
        comments: { orderBy: { createdAt: "asc" } },
      },
    });
  }

  create(data: Prisma.ContentItemCreateInput) {
    return prisma.contentItem.create({ data, select: contentListSelect });
  }

  /**
   * AZ ÁLLAPOTVÁLTÁS FELTÉTELES: a `where` tartalmazza a VÁRT mai állapotot is.
   *
   * MIÉRT: két ember egyszerre nyithatja meg ugyanazt a tételt. Ha az egyik
   * jóváhagyja, a másik pedig közben visszaküldi javításra, egy feltétel
   * nélküli írás a másodikat engedné nyerni -- csendben, és úgy, hogy az első
   * felhasználó azt hiszi, az ő döntése áll. A feltételes írás nulla sort
   * módosít, és a hívó ebből tudja, hogy közben történt valami.
   */
  async moveState(input: {
    id: string;
    from: ContentState;
    to: ContentState;
    discardReason?: string | null;
    scheduleAnchoredAt?: Date | null;
    scheduledFor?: Date | null;
  }): Promise<boolean> {
    const result = await prisma.contentItem.updateMany({
      where: { id: input.id, state: input.from },
      data: {
        state: input.to,
        ...(input.discardReason === undefined
          ? {}
          : { discardReason: input.discardReason }),
        ...(input.scheduleAnchoredAt === undefined
          ? {}
          : { scheduleAnchoredAt: input.scheduleAnchoredAt }),
        ...(input.scheduledFor === undefined
          ? {}
          : { scheduledFor: input.scheduledFor }),
      },
    });
    return result.count === 1;
  }

  addComment(input: { contentId: string; authorId: string; body: string }) {
    return prisma.contentComment.create({ data: input });
  }
}
