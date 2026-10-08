import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
} from "@nestjs/common";

import {
  redirectPathLower,
  webshopProductPath,
} from "../redirect/redirect-path.js";
import {
  RedirectError,
  writeRedirect,
  type RedirectStore,
} from "../redirect/redirect-writer.js";
import { SLUG_ALAK, SLUG_MAX, baseProductSlug, resolveSlug } from "./slug.js";

export const WEBSHOP_SLUG_STORE = Symbol("WEBSHOP_SLUG_STORE");

/** A slug tárolása; a Prisma-változat a `webshop-slug.repository.ts`-ben. */
export interface WebshopSlugStore {
  /** A termék WEBSHOP csatorna-sorának slugja, vagy `null`. */
  currentSlug(productId: string): Promise<string | null>;
  /** A slug alapja: a név és a primary cikkszám (az első aktív változaté). */
  basis(
    productId: string,
  ): Promise<{ name: string; primarySku: string | null } | null>;
  /** Az élő webshop-slugok és a `SlugHistory` termék-slugjai, a megadott előtaggal. */
  takenWithPrefix(prefix: string): Promise<Set<string>>;
  /** Kié a slug: élő (melyik terméké) vagy régi (kié volt). */
  owner(
    slug: string,
  ): Promise<{ kind: "live" | "history"; productId: string } | null>;
  /**
   * Elmenti az első slugot, és a `redirects` ugyanabban a tranzakcióban fut (PR 6:
   * az új élő címen álló szabály megszűnik). Egyedi-index ütközésnél
   * `SlugTakenError`-t dob.
   */
  saveFirst(
    productId: string,
    slug: string,
    redirects: (store: RedirectStore) => Promise<void>,
  ): Promise<void>;
  /**
   * Kézi csere: a régi slug `SlugHistory`-ba, az új élő lesz, és a `redirects`
   * ugyanabban a tranzakcióban írja az átirányítást (PR 6).
   */
  replace(
    input: {
      productId: string;
      oldSlug: string | null;
      newSlug: string;
      userId: string;
    },
    redirects: (store: RedirectStore) => Promise<void>,
  ): Promise<void>;
}

export class SlugTakenError extends Error {}

/**
 * AZ ÚJ SLUG ÉLŐ OLDAL: a `/hu/termek/<slug>` forrású aktív szabály megszűnik,
 * különben egy átirányítás állna az élő termékoldal előtt. Az első slug (a
 * `webshopSlug` és a `changeSlug` első ága) ugyanígy (barracuda, #1597 3.); a
 * slug-csere ugyanezt a `writeRedirect` `destinationIsLive` ágán kapja.
 */
const eloOldal = (slug: string) => async (redirects: RedirectStore) => {
  const celen = await redirects.findBySourceLower(
    redirectPathLower(webshopProductPath(slug)),
  );
  if (celen?.isActive) await redirects.update(celen.id, { isActive: false });
};

/**
 * A TERMÉK WEBSHOP-SLUGJA (SEO P0 PR 5; D1–D3, acrobot 27748).
 *
 * D2: a slug ELSŐ KÉRÉSKOR keletkezik (a backfill és a PR 7 vetítése hívja), nem a
 * négy létrehozó úton; egyszer keletkezik, és a név változása nem változtatja.
 * D3: a forrás a név, a terv algoritmusával.
 */
@Injectable()
export class WebshopSlugService {
  constructor(
    @Inject(WEBSHOP_SLUG_STORE) private readonly store: WebshopSlugStore,
  ) {}

  async webshopSlug(productId: string): Promise<string> {
    const meglevo = await this.store.currentSlug(productId);
    if (meglevo) return meglevo;
    const alap = await this.store.basis(productId);
    if (!alap) throw new BadRequestException(`no product ${productId}`);
    const sku = alap.primarySku ?? productId;
    const base = baseProductSlug(alap.name, sku);
    // egy párhuzamos első kérés ugyanazt a slugot is választhatja: az egyedi index
    // dönt, és a vesztes újraszámol
    for (let probalkozas = 0; probalkozas < 3; probalkozas++) {
      const slug = resolveSlug(
        base,
        sku,
        await this.store.takenWithPrefix(base),
      );
      try {
        await this.store.saveFirst(productId, slug, eloOldal(slug));
        return slug;
      } catch (error) {
        if (!(error instanceof SlugTakenError)) throw error;
        const kozben = await this.store.currentSlug(productId);
        if (kozben) return kozben;
      }
    }
    throw new ConflictException(
      `could not assign a webshop slug to ${productId}`,
    );
  }

  /**
   * KÉZI CSERE: a régi slug `SlugHistory`-ba kerül, és többé senki más nem
   * kaphatja meg. A termék a SAJÁT régi slugját visszakaphatja.
   *
   * AZ ÁTIRÁNYÍTÁS UGYANABBAN A TRANZAKCIÓBAN (PR 6): `/hu/termek/<régi>` →
   * `/hu/termek/<új>`, és a régi címre mutató korábbi szabályok az újra íródnak át
   * (két egymás utáni csere után nincs lánc). Az új slug élő oldal, tehát a rajta
   * álló régi szabály megszűnik.
   */
  async changeSlug(
    productId: string,
    newSlug: unknown,
    userId: string,
  ): Promise<string> {
    if (
      typeof newSlug !== "string" ||
      newSlug.length > SLUG_MAX ||
      !SLUG_ALAK.test(newSlug)
    )
      throw new BadRequestException(
        `slug: lowercase letters, digits and single hyphens, at most ${SLUG_MAX} characters`,
      );
    const regi = await this.store.currentSlug(productId);
    if (regi === newSlug) return newSlug;
    const gazda = await this.store.owner(newSlug);
    if (gazda && gazda.productId !== productId)
      throw new ConflictException(
        `slug "${newSlug}" ${gazda.kind === "live" ? "belongs to" : "was used by"} product ${gazda.productId}`,
      );
    try {
      await this.store.replace(
        { productId, oldSlug: regi, newSlug, userId },
        async (redirects) => {
          // az első slug: nincs régi cím, de az új élő oldalon ne álljon szabály
          if (!regi) return eloOldal(newSlug)(redirects);
          await writeRedirect(redirects, {
            source: webshopProductPath(regi),
            destination: webshopProductPath(newSlug),
            reason: "SLUG_CHANGE",
            entityType: "PRODUCT",
            entityId: productId,
            createdById: userId,
            onExisting: "replace",
            destinationIsLive: true,
          });
        },
      );
    } catch (error) {
      if (error instanceof RedirectError)
        throw new ConflictException(`redirect: ${error.message}`);
      // a mérés és az írás között valaki más vette el
      if (error instanceof SlugTakenError)
        throw new ConflictException(`slug "${newSlug}" is taken`);
      throw error;
    }
    return newSlug;
  }
}
