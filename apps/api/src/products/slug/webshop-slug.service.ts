import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
} from "@nestjs/common";

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
  /** Elmenti az első slugot. Egyedi-index ütközésnél `SlugTakenError`-t dob. */
  saveFirst(productId: string, slug: string): Promise<void>;
  /** Kézi csere: a régi slug `SlugHistory`-ba, az új élő lesz; egy tranzakció. */
  replace(input: {
    productId: string;
    oldSlug: string | null;
    newSlug: string;
    userId: string;
  }): Promise<void>;
}

export class SlugTakenError extends Error {}

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
        await this.store.saveFirst(productId, slug);
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
   * KÉZI CSERE: a régi slug `SlugHistory`-ba kerül (ebből generál a PR 6 301-et),
   * és többé senki más nem kaphatja meg. A termék a SAJÁT régi slugját
   * visszakaphatja.
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
      await this.store.replace({ productId, oldSlug: regi, newSlug, userId });
    } catch (error) {
      // a mérés és az írás között valaki más vette el
      if (error instanceof SlugTakenError)
        throw new ConflictException(`slug "${newSlug}" is taken`);
      throw error;
    }
    return newSlug;
  }
}
