import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { OperationsLogEntriesRepository } from "./operations-log-entries.repository.js";
import { OperationsLogEntriesService } from "./operations-log-entries.service.js";
import { ServiceJobsRepository } from "../service-jobs/service-jobs.repository.js";
import { ServiceJobsService } from "../service-jobs/service-jobs.service.js";
import { OperationsLogPhotosService } from "./operations-log-photos.service.js";
import { OperationsLogRepository } from "./operations-log.repository.js";

/**
 * AZ ÜZEMELTETÉSI NAPLÓ BEJEGYZÉSEI VALÓDI POSTGRESEN (task os-uzemeltetesi-naplo, S2a; migráció
 * `20261113120000_operations_log_entry`).
 *
 * Két dolgot mér, amit mockkal nem lehet: (1) a migráció kézzel írt CHECK-jeit (idő-sorrend, rendellenesség-leírás, az érték-oszlop
 * a típushoz, egység és szerep csak számon) a szolgáltatást megkerülő írásra is, és (2) az idempotens rögzítést a valódi egyedi
 * indexen, két párhuzamos újraküldéssel.
 *
 * MINDEN TILTOTT ESETNEK VAN ÉRVÉNYES PÁRJA: ha a fixtúra maga lenne hibás, a tiltott eset ugyanúgy elbukna, és a teszt a
 * megkötés nélkül is zöld maradna.
 */
const gate = integrationDatabaseGate(process.env);
const PREFIX = "UZE-INT-";

describe(
  "az üzemeltetési napló bejegyzései adatbázison",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = Date.now() % 1_000_000;
    const templates = new OperationsLogRepository();
    const service = new OperationsLogEntriesService(
      new OperationsLogEntriesRepository(),
      templates,
      new ServiceJobsService(new ServiceJobsRepository()),
    );
    const photos = new OperationsLogPhotosService(
      new OperationsLogEntriesRepository(),
      templates,
      // a tároló be nem kapcsolt környezetben a kép az adatbázisba megy (a közös mag dönt), a tárolóhoz itt nem nyúlunk
      {} as never,
    );
    const ids = {
      asset: "",
      template: "",
      recorder: "",
      colleague: "",
      stranger: "",
    };
    const name = (label: string) => `${PREFIX}${label}-${suffix}`;
    const at = (minutesAgo: number) =>
      new Date(Date.now() - minutesAgo * 60_000);

    async function removeLeftovers() {
      await prisma.operationsLogEntry.deleteMany({
        where: { templateName: { startsWith: PREFIX } },
      });
      // a rendellenességből nyílt hibajegyek (S3) a tesztvevőé: a vevő és a helyszín törlése előtt mennek
      await prisma.serviceJob.deleteMany({
        where: { customer: { customerNumber: { startsWith: PREFIX } } },
      });
      await prisma.operationsTaskTemplate.deleteMany({
        where: { name: { startsWith: PREFIX } },
      });
      await prisma.asset.deleteMany({
        where: { assetNumber: { startsWith: PREFIX } },
      });
      await prisma.worksheetDepartment.deleteMany({
        where: { name: { startsWith: PREFIX } },
      });
      await prisma.customer.deleteMany({
        where: { customerNumber: { startsWith: PREFIX } },
      });
      await prisma.supplier.deleteMany({
        where: { code: { startsWith: "UZEI" } },
      });
      await prisma.user.deleteMany({
        where: { email: { startsWith: PREFIX.toLowerCase() } },
      });
    }

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      const user = (label: string, role: "SERVICE" | "VIEWER" = "SERVICE") =>
        prisma.user.create({
          data: {
            email: `${PREFIX.toLowerCase()}${label}-${suffix}@example.invalid`,
            displayName: `${PREFIX}${label}`,
            role,
          },
          select: { id: true },
        });
      ids.recorder = (await user("rogzito")).id;
      ids.colleague = (await user("kollega")).id;
      // a nézőből nem lehet kiosztott kolléga: a szolgáltatás elutasítja
      ids.stranger = (await user("nezo", "VIEWER")).id;
      const customer = await prisma.customer.create({
        data: {
          customerNumber: `${PREFIX}${suffix}`,
          type: "COMPANY",
          displayName: `${PREFIX}vevő ${suffix}`,
        },
        select: { id: true },
      });
      const department = await prisma.worksheetDepartment.create({
        data: { customerId: customer.id, code: "UZE", name: name("hely") },
        select: { id: true },
      });
      const supplier = await prisma.supplier.create({
        data: { code: `UZEI${suffix}`.slice(0, 12), name: name("szállító") },
        select: { id: true },
      });
      ids.asset = (
        await prisma.asset.create({
          data: {
            assetNumber: name("ESZK"),
            name: name("homokszűrő"),
            supplierId: supplier.id,
            departmentId: department.id,
          },
          select: { id: true },
        })
      ).id;
      const created = await prisma.operationsTaskTemplate.create({
        data: {
          name: name("sablon"),
          frequency: "WEEKLY",
          assetId: ids.asset,
          fields: {
            create: [
              {
                key: "elotte",
                label: "Vízóra előtte",
                type: "NUMBER",
                unit: "m3",
                required: true,
                meterRole: "BEFORE",
                sortOrder: 0,
              },
              {
                key: "rendben",
                label: "Rendben",
                type: "BOOLEAN",
                sortOrder: 1,
              },
              {
                key: "megjegyzes",
                label: "Megjegyzés",
                type: "TEXT",
                sortOrder: 2,
              },
              {
                key: "kep",
                label: "Fénykép",
                type: "PHOTO",
                sortOrder: 3,
              },
            ],
          },
        },
        select: { id: true },
      });
      ids.template = created.id;
    });

    after(async () => {
      if (gate.mode === "run") await removeLeftovers();
    });

    const input = (key: string, over: Record<string, unknown> = {}) => ({
      clientOperationId: `${PREFIX}${key}-${suffix}`,
      templateId: ids.template,
      assetId: ids.asset,
      templateFieldKeys: ["elotte", "rendben", "megjegyzes"],
      startedAt: at(30).toISOString(),
      finishedAt: at(10).toISOString(),
      values: { elotte: 12.5, rendben: false, megjegyzes: "tiszta" },
      ...over,
    });

    const row = (over: Record<string, unknown> = {}) =>
      prisma.operationsLogEntry.create({
        data: {
          templateId: ids.template,
          assetId: ids.asset,
          templateName: name("sablon"),
          frequency: "WEEKLY",
          startedAt: at(30),
          finishedAt: at(10),
          recordedById: ids.recorder,
          ...over,
        },
        select: { id: true },
      });

    describe("a bejegyzés megkötései", () => {
      it("a vége nem lehet a kezdet előtt; az egyenlő idő és a sorrendben álló rendben van", async () => {
        await row();
        await row({ startedAt: at(10), finishedAt: at(10) });
        await assert.rejects(
          row({ startedAt: at(10), finishedAt: at(30) }),
          /OperationsLogEntry_finished_not_before_started/,
        );
      });

      it("rendellenességhez leírás kell, anélkül nincs leírás", async () => {
        await row({ anomaly: true, anomalyNote: "Szivárog" });
        await assert.rejects(
          row({ anomaly: true }),
          /OperationsLogEntry_anomaly_note/,
        );
        await assert.rejects(
          row({ anomaly: true, anomalyNote: "  " }),
          /OperationsLogEntry_anomaly_note/,
        );
        await assert.rejects(
          row({ anomaly: false, anomalyNote: "Mégis" }),
          /OperationsLogEntry_anomaly_note/,
        );
      });

      it("a kliens-azonosító egyedi", async () => {
        const key = `${PREFIX}egyedi-${suffix}`;
        await row({ clientOperationId: key });
        await assert.rejects(
          row({ clientOperationId: key }),
          /clientOperationId/,
        );
      });

      it("az érték-oszlop a típushoz tartozik, egység és szerep csak számon", async () => {
        const entry = await row();
        const value = (over: Record<string, unknown>) =>
          prisma.operationsLogEntryValue.create({
            data: {
              entryId: entry.id,
              fieldKey: `k${Math.random().toString(36).slice(2, 8)}`,
              fieldType: "NUMBER",
              label: "mező",
              numberValue: 1,
              ...over,
            },
            select: { id: true },
          });
        await value({});
        await value({
          fieldType: "BOOLEAN",
          numberValue: null,
          booleanValue: false,
        });
        await value({ fieldType: "TEXT", numberValue: null, textValue: "x" });
        await value({ unit: "m3", meterRole: "AFTER" });
        await assert.rejects(
          value({ fieldType: "BOOLEAN" }),
          /OperationsLogEntryValue_one_value_matches_type/,
        );
        await assert.rejects(
          value({ textValue: "x" }),
          /OperationsLogEntryValue_one_value_matches_type/,
        );
        await assert.rejects(
          value({ numberValue: null }),
          /OperationsLogEntryValue_one_value_matches_type/,
        );
        await assert.rejects(
          value({
            fieldType: "TEXT",
            numberValue: null,
            textValue: "x",
            unit: "m3",
          }),
          /OperationsLogEntryValue_number_only_unit_role/,
        );
        // egy mező egyszer szerepelhet egy bejegyzésben
        await value({ fieldKey: "ugyanaz" });
        await assert.rejects(
          value({ fieldKey: "ugyanaz" }),
          /entryId.*fieldKey|fieldKey.*entryId/,
        );
      });

      it("a sablont és az eszközt a bejegyzés megtartja (Restrict); a bejegyzés törlése viszi az értékeit és a résztvevőit", async () => {
        const entry = await row();
        await prisma.operationsLogEntryParticipant.create({
          data: { entryId: entry.id, userId: ids.recorder },
        });
        await prisma.operationsLogEntryValue.create({
          data: {
            entryId: entry.id,
            fieldKey: "k1",
            fieldType: "NUMBER",
            label: "mező",
            numberValue: 1,
          },
        });
        await assert.rejects(
          prisma.operationsTaskTemplate.delete({ where: { id: ids.template } }),
        );
        await assert.rejects(prisma.asset.delete({ where: { id: ids.asset } }));
        await prisma.operationsLogEntry.delete({ where: { id: entry.id } });
        assert.equal(
          await prisma.operationsLogEntryValue.count({
            where: { entryId: entry.id },
          }),
          0,
        );
        assert.equal(
          await prisma.operationsLogEntryParticipant.count({
            where: { entryId: entry.id },
          }),
          0,
        );
      });
    });

    describe("a rögzítés a szolgáltatáson át", () => {
      it("rögzít: pillanatfelvétel az érték mellett, a rögzítő és a kolléga résztvevő", async () => {
        const result = await service.create(
          input("rogzit", { participantIds: [ids.colleague] }),
          ids.recorder,
        );
        assert.equal(result.created, true);
        const entry = result.entry;
        assert.equal(entry.templateName, name("sablon"));
        assert.deepEqual(
          entry.participants.map((p) => p.id).sort(),
          [ids.recorder, ids.colleague].sort(),
        );
        const elotte = entry.values.find((v) => v.fieldKey === "elotte")!;
        assert.equal(elotte.value, 12.5);
        assert.equal(elotte.unit, "m3");
        assert.equal(elotte.meterRole, "BEFORE");
        assert.equal(
          entry.values.find((v) => v.fieldKey === "rendben")!.value,
          false,
        );
        // a sablon későbbi átnevezése a rögzített bejegyzést nem változtatja
        await prisma.operationsTaskField.updateMany({
          where: { templateId: ids.template, key: "elotte" },
          data: { label: "Átnevezve", unit: "liter" },
        });
        const reread = await service.get(entry.id);
        assert.equal(
          reread.values.find((v) => v.fieldKey === "elotte")!.label,
          "Vízóra előtte",
        );
        assert.equal(
          reread.values.find((v) => v.fieldKey === "elotte")!.unit,
          "m3",
        );
        await prisma.operationsTaskField.updateMany({
          where: { templateId: ids.template, key: "elotte" },
          data: { label: "Vízóra előtte", unit: "m3" },
        });
      });

      it("az újraküldés a meglévőt adja; két párhuzamos újraküldés is egyetlen sort hagy", async () => {
        const first = await service.create(input("ujra"), ids.recorder);
        const again = await service.create(input("ujra"), ids.recorder);
        assert.equal(again.created, false);
        assert.equal(again.entry.id, first.entry.id);

        const racing = input("verseny");
        const results = await Promise.all([
          service.create(racing, ids.recorder),
          service.create(racing, ids.recorder),
        ]);
        assert.equal(results[0].entry.id, results[1].entry.id);
        assert.equal(results.filter((r) => r.created).length, 1);
        assert.equal(
          await prisma.operationsLogEntry.count({
            where: { clientOperationId: racing.clientOperationId },
          }),
          1,
        );
      });

      it("más rögzítő ugyanazzal a kulccsal 409, és a rossz bemenet semmit nem hagy a táblában", async () => {
        await service.create(input("sajat"), ids.recorder);
        await assert.rejects(
          service.create(input("sajat"), ids.colleague),
          /már egy másik rögzítésé/,
        );
        const before = await prisma.operationsLogEntry.count();
        await assert.rejects(
          service.create(input("rossz", { values: {} }), ids.recorder),
          /kötelező kitölteni/,
        );
        await assert.rejects(
          service.create(
            input("idegen", { participantIds: [ids.stranger] }),
            ids.recorder,
          ),
          /nem választható kolléga/,
        );
        assert.equal(await prisma.operationsLogEntry.count(), before);
      });

      it("a lista az időrendben legújabbat adja, és a limit felett jelzi, hogy van még", async () => {
        const page = await service.list({ assetId: ids.asset, limit: 1 });
        assert.equal(page.items.length, 1);
        assert.equal(page.hasMore, true);
        const all = await service.list({ assetId: ids.asset, limit: 200 });
        const times = all.items.map((item) => Date.parse(item.startedAt));
        assert.deepEqual(
          times,
          [...times].sort((a, b) => b - a),
        );
        const anomalies = await service.list({
          assetId: ids.asset,
          anomalyOnly: true,
        });
        assert.ok(anomalies.items.every((item) => item.anomaly));
      });
    });

    describe("a rendellenességből nyíló hibajegy", () => {
      it("a rendellenes bejegyzés hibajegyet nyit az eszközhöz, és az újraküldés nem nyit másodikat", async () => {
        const body = input("rendellenes", {
          anomaly: true,
          anomalyNote: "Szivárog a szelep",
        });
        const first = await service.create(body, ids.recorder);
        const ticket = first.entry.serviceJob;
        assert.ok(ticket, "a bejegyzésen nincs hibajegy");
        assert.match(ticket.jobNumber, /^\S+$/);
        const job = await prisma.serviceJob.findUniqueOrThrow({
          where: { id: ticket.id },
          select: {
            title: true,
            description: true,
            assets: { select: { assetId: true } },
            operationsLogEntry: { select: { id: true } },
          },
        });
        assert.match(job.title, /^Rendellenesség: /);
        assert.match(job.description ?? "", /^Szivárog a szelep/);
        assert.deepEqual(
          job.assets.map((link) => link.assetId),
          [ids.asset],
        );
        assert.equal(job.operationsLogEntry?.id, first.entry.id);

        const again = await service.create(body, ids.recorder);
        assert.equal(again.created, false);
        assert.equal(again.entry.serviceJob?.id, ticket.id);
        assert.equal(
          await prisma.serviceJob.count({
            where: { clientOperationId: `ops-anomaly:${first.entry.id}` },
          }),
          1,
        );
      });

      it("a hiányzó összekötést az újraküldés pótolja, jegy nélkül nincs rendellenesség nélküli jegy", async () => {
        const body = input("elvalasztott", {
          anomaly: true,
          anomalyNote: "Hibás nyomásmérő",
        });
        const first = await service.create(body, ids.recorder);
        // a jegy létrejött, de az összekötés elmaradt (megszakadt kör)
        await prisma.operationsLogEntry.update({
          where: { id: first.entry.id },
          data: { serviceJobId: null },
        });
        const healed = await service.create(body, ids.recorder);
        assert.equal(healed.entry.serviceJob?.id, first.entry.serviceJob?.id);
        const calm = await service.create(input("nyugodt"), ids.recorder);
        assert.equal(calm.entry.serviceJob, null);
      });
    });

    describe("a fénykép mezők képei", () => {
      // 1x1 pixeles PNG
      const PNG = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
        "base64",
      );
      const png = () =>
        ({
          originalname: "kep.png",
          mimetype: "image/png",
          buffer: PNG,
        }) as Express.Multer.File;

      it("a kép a bejegyzéshez kötött, a bájtjai visszaolvashatók, az újraküldés ugyanazt adja", async () => {
        const { entry } = await service.create(input("kepes"), ids.recorder);
        const first = await photos.addPhoto(entry.id, png(), ids.recorder, {
          fieldKey: "kep",
          clientOperationId: `${PREFIX}kep1-${suffix}`,
        });
        assert.equal(first.created, true);
        assert.equal(first.photo.fieldLabel, "Fénykép");
        const again = await photos.addPhoto(entry.id, png(), ids.recorder, {
          fieldKey: "kep",
          clientOperationId: `${PREFIX}kep1-${suffix}`,
        });
        assert.equal(again.created, false);
        assert.equal(again.photo.id, first.photo.id);
        assert.equal(
          await prisma.operationsLogEntryDocument.count({
            where: { entryId: entry.id },
          }),
          1,
        );
        const reread = await service.get(entry.id);
        assert.deepEqual(
          reread.photos.map((photo) => photo.id),
          [first.photo.id],
        );
        const bytes = await photos.photoBytes(entry.id, first.photo.id);
        assert.deepEqual(bytes.bytes, PNG);
        assert.equal(bytes.contentType, "image/png");
      });

      it("két párhuzamos újraküldés egyetlen képet hagy", async () => {
        const { entry } = await service.create(
          input("kepverseny"),
          ids.recorder,
        );
        const send = () =>
          photos.addPhoto(entry.id, png(), ids.recorder, {
            fieldKey: "kep",
            clientOperationId: `${PREFIX}kepverseny-${suffix}`,
          });
        const results = await Promise.all([send(), send()]);
        assert.equal(results[0].photo.id, results[1].photo.id);
        assert.equal(results.filter((r) => r.created).length, 1);
        assert.equal(
          await prisma.operationsLogEntryDocument.count({
            where: { entryId: entry.id },
          }),
          1,
        );
      });

      it("idegen rögzítő nem csatolhat, nem fénykép mezőre nem megy, a bejegyzés törlése viszi a képeit", async () => {
        const { entry } = await service.create(input("kepjog"), ids.recorder);
        await assert.rejects(
          photos.addPhoto(entry.id, png(), ids.colleague, { fieldKey: "kep" }),
          /csak a bejegyzés rögzítője/,
        );
        await assert.rejects(
          photos.addPhoto(entry.id, png(), ids.recorder, {
            fieldKey: "elotte",
          }),
          /nem fénykép mező/,
        );
        await photos.addPhoto(entry.id, png(), ids.recorder, {
          fieldKey: "kep",
        });
        await prisma.operationsLogEntry.delete({ where: { id: entry.id } });
        assert.equal(
          await prisma.operationsLogEntryDocument.count({
            where: { entryId: entry.id },
          }),
          0,
        );
      });
    });
  },
);
