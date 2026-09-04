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

  /**
   * `async`, ES NEM DISZ: a Prisma `create` nem sima Promise-t ad vissza, hanem
   * a sajat kliens-objektumat (`Prisma__ContentItemClient`), amin tovabbi
   * metodusok is ulnek. Amig ez szivargott ki a varraton, egy teszt-dupla NEM
   * volt tipizalhato ra -- a fordito szo szerint ezt mondta: "Property
   * 'comments' is missing in type 'Promise<...>'".
   *
   * Az `async` a visszateresi tipust arra szukiti, amit a hivo TENYLEG hasznal,
   * es ettol a varrat mockolhato lesz. Ez nem viselkedes-valtozas: a hivok
   * eddig is await-eltek.
   */
  async create(data: Prisma.ContentItemCreateInput) {
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
  /**
   * A LÉPÉS ÉS A HOZZÁ TARTOZÓ FELVETÉS EGY TRANZAKCIÓBAN MEGY.
   *
   * MIÉRT NEM KÉT HÍVÁS: mindkét sorrend hagy egy rossz állapotot. Ha előbb a
   * hozzászólás születik meg és az állapotváltás bukik (mert a tétel közben
   * elmozdult), egy árva felvetés marad egy olyan tételen, ami már máshol jár.
   * Ha előbb az állapot vált és a hozzászólás bukik, a tétel javításra vár --
   * indok nélkül, vagyis pontosan abban az állapotban, amit ez a mező meg akar
   * szüntetni.
   *
   * A FELTÉTELES ÍRÁS A TRANZAKCIÓN BELÜL IS FELTÉTELES: ha nulla sort módosít,
   * a hozzászólás létre sem jön, mert ezt az ágat előbb ellenőrizzük.
   */
  async moveState(input: {
    id: string;
    from: ContentState;
    to: ContentState;
    discardReason?: string | null;
    scheduleAnchoredAt?: Date | null;
    scheduledFor?: Date | null;
    /** A lépéshez tartozó felvetés, hozzászólásként. Csak együtt születik meg. */
    note?: { authorId: string; body: string };
  }): Promise<boolean> {
    return prisma.$transaction(async (tx) => {
      const result = await tx.contentItem.updateMany({
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

      if (result.count !== 1) return false;

      if (input.note)
        await tx.contentComment.create({
          data: {
            contentId: input.id,
            authorId: input.note.authorId,
            body: input.note.body,
          },
        });

      return true;
    });
  }

  /**
   * EGY BEADOTT TETEL SZOVEGENEK JAVITASA -- ALLAPOT-ORZOVEL, EGY TRANZAKCIOBAN.
   *
   * === MIERT `updateMany` EGY `update` HELYETT ===
   *
   * Ugyanaz a minta, mint a `moveState`-nel, es ugyanabbol az okbol: a `where`
   * feltetelbe bekerul az ALLAPOT is. Ha a hivo olvasasa ota barki elorevitte a
   * tetelt (peldaul Balazs jovahagyta), a feltetel nem illeszkedik, es a javitas
   * NEM tortenik meg -- ahelyett hogy rairna egy mar jovahagyott szovegre.
   *
   * Egy `update` id alapjan ezt nem tudna: az olvasas es az iras kozott eltelt
   * ido pontosan az az ablak, amiben a jovahagyas beleferne.
   *
   * === ES MIERT UGYANABBAN A TRANZAKCIOBAN A NYOM ===
   *
   * A hozzaszolas nem naplo-diszlet: az az EGYETLEN hely, ahol a jovahagyo
   * latja, hogy a szoveg megvaltozott azota, hogy elolvasta. Ha kulon irodna,
   * letezne olyan allapot, ahol a szoveg mar mas, es nyoma nincs -- es epp az a
   * nema feluliras, ami ellen az egesz keszul.
   */
  async reviseText(input: {
    id: string;
    allowedStates: readonly ContentState[];
    data: { title?: string; body?: string };
    note: { authorId: string; body: string };
  }): Promise<boolean> {
    return prisma.$transaction(async (tx) => {
      const result = await tx.contentItem.updateMany({
        where: { id: input.id, state: { in: [...input.allowedStates] } },
        data: input.data,
      });

      if (result.count !== 1) return false;

      await tx.contentComment.create({
        data: {
          contentId: input.id,
          authorId: input.note.authorId,
          body: input.note.body,
        },
      });

      return true;
    });
  }

  addComment(input: { contentId: string; authorId: string; body: string }) {
    return prisma.contentComment.create({ data: input });
  }
}
