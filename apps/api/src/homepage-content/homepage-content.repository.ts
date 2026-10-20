import { Injectable } from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";
import type { HomepageContentInput } from "@acropora/types";

import type {
  HomepageContentRow,
  HomepageContentStore,
} from "./homepage-content.service.js";

/** The home page content in Postgres: one row per key, written whole. */
@Injectable()
export class HomepageContentRepository implements HomepageContentStore {
  find(key: string): Promise<HomepageContentRow | null> {
    return prisma.homepageContent.findUnique({ where: { key } });
  }

  setProjection(
    key: string,
    enabled: boolean,
    userId: string,
  ): Promise<HomepageContentRow> {
    return prisma.homepageContent.upsert({
      where: { key },
      // a row nobody has written content to yet: no overrides, slides not set
      create: {
        key,
        texts: {},
        slides: Prisma.DbNull,
        projectionEnabled: enabled,
        updatedById: userId,
      },
      update: { projectionEnabled: enabled, updatedById: userId },
    });
  }

  save(
    key: string,
    input: HomepageContentInput,
    userId: string,
  ): Promise<HomepageContentRow> {
    const data = {
      texts: input.texts as unknown as Prisma.InputJsonValue,
      // null in a nullable Json column is the database NULL (not set)
      slides:
        input.slides === null
          ? Prisma.DbNull
          : (input.slides as unknown as Prisma.InputJsonValue),
      updatedById: userId,
    };
    return prisma.homepageContent.upsert({
      where: { key },
      create: { key, ...data },
      update: data,
    });
  }
}
