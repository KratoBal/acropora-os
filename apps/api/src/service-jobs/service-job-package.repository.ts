import { Injectable } from "@nestjs/common";
import { prisma, type Prisma } from "@acropora/database";

import { WORKSHEET_ISSUED_SHEET_TYPES } from "@acropora/types";
import { unitPathFor } from "../common/unit-path-lookup.js";
import { assignedUnitIdsFor } from "./assigned-units.query.js";

@Injectable()
export class ServiceJobPackageRepository {
  private readonly database = prisma;

  async packageData(id: string, visibility: Prisma.ServiceJobWhereInput) {
    const job = await this.database.serviceJob.findFirst({
      where: { AND: [{ id }, visibility] },
      select: {
        id: true,
        jobNumber: true,
        title: true,
        description: true,
        status: true,
        createdAt: true,
        departmentId: true,
        customer: { select: { displayName: true } },
        events: {
          where: { kind: "STATUS_CHANGE" },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            createdAt: true,
            toStatus: true,
            note: true,
            actor: { select: { displayName: true } },
          },
        },
        assets: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { asset: { select: { assetNumber: true, name: true } } },
        },
        assignees: {
          orderBy: [{ assignedAt: "asc" }, { userId: "asc" }],
          select: { user: { select: { displayName: true } } },
        },
        documents: {
          where: { type: "PHOTO" },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { thumbnail: true, caption: true },
        },
        worksheets: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            /*
              A SZAM A KAPU MONDATAHOZ KELL. A csomag maga nem hasznalja (a
              fajlnev a dokumentum sorabol jon), de a visszatartas mondatanak
              MEG KELL NEVEZNIE a lapot -- egy puszta "van lezaratlan lap" a
              kezelot keresesre kuldi.
            */
            number: true,
            hiddenAt: true,
            versions: {
              orderBy: { version: "desc" },
              take: 1,
              /*
                A `closedAt` A KAPUE, NEM A CSOMAGE. Ez az EGYETLEN mezo, ami
                megkulonbozteti a "meg nincs lezarva" esetet a "le van zarva,
                de a kiadott lap hianyzik" esettol -- es a ketto TEENDOJE mas.
              */
              select: { id: true, closedAt: true },
            },
            documents: {
              /*
                MIND A KET KIADOTT LAP, es a halmaz KOZOS konstansbol jon: a
                lezaraskori (`GENERATED_SHEET`) mellett 2026-09-21 ota all az
                alairas utani, vegleges (`SIGNED_SHEET`). A valasztast a
                `preferSignedSheet` vegzi a szolgaltatasban -- ide a teljes
                halmaz kell, kulonben a vegleges lap ELO SEM KERUL.
              */
              where: { type: { in: [...WORKSHEET_ISSUED_SHEET_TYPES] } },
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              select: {
                id: true,
                worksheetVersionId: true,
                /*
                  A TIPUS AZERT KELL A VALASZBA, mert a valasztas RAJTA all
                  (`preferSignedSheet`). Enelkul a hivo csak a sorrendbol
                  tudna valasztani -- es az EGYBEESES, nem szabaly.
                */
                type: true,
                fileName: true,
                contentType: true,
                content: true,
                storageKey: true,
              },
            },
          },
        },
      },
    });
    if (!job) return null;
    return {
      ...job,
      departmentPath: await unitPathFor(this.database, job.departmentId),
    };
  }

  /**
   * UGYANAZ A FORRAS, MINT A JEGY-TAROLOBAN -- ES EZ JAVITAS, NEM ATRENDEZES.
   *
   * Ez a metodus korabban CSAK lekerdezett, reszfa-kibontas nelkul, mikozben a
   * jegy-taroló azonos nevu metodusa kibontott -- es mind a ketto UGYANANNAK a
   * `serviceJobVisibilityFor` fuggvenynek a bemenete. A reszletek az
   * `assigned-units.query.ts` fejlecében allnak.
   */
  assignedUnitIds(userId: string) {
    return assignedUnitIdsFor(userId);
  }
}
