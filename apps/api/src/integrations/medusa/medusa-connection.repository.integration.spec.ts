import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "@acropora/database";

import { MedusaConnectionRepository } from "./medusa-connection.repository.js";
import { encryptMedusaCredential } from "./medusa-credential-crypto.service.js";
import { integrationDatabaseGate } from "../../common/integration-database.js";

/**
 * A TÁROLÁS mérve, valódi PostgreSQL ellen.
 *
 * Amit itt bizonyítani kell, azt egy hamisított kliens nem tudná: hogy a
 * boríték BYTEA oszlopokban él és karakterre visszajön, hogy a revízió-zár két
 * párhuzamos írás közül pontosan egyet enged át, és hogy a letiltás tényleg
 * eltünteti a kulcsot, nem csak a módot írja át. Egy hamisítvány mindhármat
 * "megvédené" akkor is, ha a migráció soha nem futott volna le.
 */

// Ez a készlet sorokat ír és töröl, ezért csak tesztelésre szánt adatbázison
// fut; lásd integrationDatabaseGate.
const gate = integrationDatabaseGate(process.env);
const runIntegration = gate.mode !== "skip";

const masterKeyEnvironment = {
  MEDUSA_CREDENTIAL_ACTIVE_KEY_VERSION: "1",
  MEDUSA_CREDENTIAL_MASTER_KEY_V1: Buffer.alloc(32, 5).toString("base64"),
};

describe(
  "MedusaConnectionRepository integration",
  { skip: !runIntegration },
  () => {
    const repository = new MedusaConnectionRepository();
    let actorId = "";

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      const actor = await prisma.user.create({
        data: {
          email: `medusa-connection-${Date.now()}@example.invalid`,
          displayName: "Medusa connection integration actor",
          role: "ADMIN",
        },
      });
      actorId = actor.id;

      /**
       * A migráció EGYETLEN sort hoz létre, `ENV_FALLBACK` módban. Ezt itt
       * állítjuk, mert ha a sor hiányozna, minden alábbi állítás azzal a
       * hibával bukna el, ami a legkevésbé mond valamit.
       */
      const migratedSingleton = await prisma.medusaConnectionSetting.findUnique(
        { where: { id: "medusa" } },
      );
      assert.ok(
        migratedSingleton,
        "a migrációnak létre kell hoznia a medusa sort",
      );
      await prisma.medusaConnectionSetting.update({
        where: { id: "medusa" },
        data: {
          credentialMode: "ENV_FALLBACK",
          encryptedApiKey: null,
          encryptionIv: null,
          authenticationTag: null,
          keyVersion: null,
          credentialRevision: 0,
          credentialUpdatedAt: null,
          credentialUpdatedByUserId: null,
          verificationStatus: "NEVER",
          lastVerifiedAt: null,
          lastVerificationCode: null,
        },
      });
    });

    after(async () => {
      await prisma.auditLog.deleteMany({
        where: { entityType: "MedusaConnectionSetting" },
      });
      await prisma.medusaConnectionSetting.update({
        where: { id: "medusa" },
        data: {
          credentialMode: "ENV_FALLBACK",
          encryptedApiKey: null,
          encryptionIv: null,
          authenticationTag: null,
          keyVersion: null,
          credentialRevision: 0,
          credentialUpdatedAt: null,
          credentialUpdatedByUserId: null,
        },
      });
      if (actorId) await prisma.user.delete({ where: { id: actorId } });
    });

    it("stores the envelope in bytes, and gives back exactly what went in", async () => {
      const envelope = encryptMedusaCredential(
        "sk_integracio",
        1,
        masterKeyEnvironment,
      );

      const saved = await repository.replaceCredential({
        envelope,
        revision: 1,
        actorUserId: actorId,
        updatedAt: new Date(),
      });

      assert.equal(saved.credentialMode, "DATABASE");
      assert.equal(saved.keyVersion, "1");
      assert.equal(saved.credentialRevision, 1);
      // Nem a mentés visszatérési értékét hisszük el, hanem visszaolvassuk.
      const reread = await repository.getSetting();
      assert.deepEqual(
        Buffer.from(reread!.encryptedApiKey!),
        envelope.encryptedApiKey,
      );
      assert.deepEqual(
        Buffer.from(reread!.encryptionIv!),
        envelope.encryptionIv,
      );
      assert.deepEqual(
        Buffer.from(reread!.authenticationTag!),
        envelope.authenticationTag,
      );
    });

    /**
     * A REVÍZIÓ-ZÁR. Két csere ugyanarról a kiindulásról: az elsőnek át kell
     * mennie, a másodiknak el kell buknia. Enélkül a második csendben
     * felülírná az elsőt, és utána senki nem tudná megmondani, melyik kulcs áll
     * a rendszerben.
     */
    it("lets exactly one of two concurrent rotations through", async () => {
      const current = await repository.getSetting();
      const next = current!.credentialRevision + 1;

      await repository.replaceCredential({
        envelope: encryptMedusaCredential(
          "sk_elso",
          next,
          masterKeyEnvironment,
        ),
        revision: next,
        actorUserId: actorId,
        updatedAt: new Date(),
      });

      await assert.rejects(
        repository.replaceCredential({
          envelope: encryptMedusaCredential(
            "sk_masodik",
            next,
            masterKeyEnvironment,
          ),
          revision: next,
          actorUserId: actorId,
          updatedAt: new Date(),
        }),
        /MEDUSA_CONNECTION_CONCURRENT_UPDATE/,
      );

      const after = await repository.getSetting();
      assert.equal(after!.credentialRevision, next);
    });

    /**
     * A LETILTÁS a kulcsot is elviszi, nem csak a módot. Egy letiltott
     * kapcsolat mellett ott felejtett titkosított kulcs olyan kockázat,
     * amiért cserébe semmit nem kapunk.
     */
    it("clears the envelope when the connection is disabled", async () => {
      await repository.disable(actorId, new Date());

      const disabled = await repository.getSetting();
      assert.equal(disabled!.credentialMode, "DISABLED");
      assert.equal(disabled!.encryptedApiKey, null);
      assert.equal(disabled!.encryptionIv, null);
      assert.equal(disabled!.authenticationTag, null);
      assert.equal(disabled!.keyVersion, null);
    });

    it("leaves an audit trail for every credential change", async () => {
      const entries = await prisma.auditLog.findMany({
        where: { entityType: "MedusaConnectionSetting" },
        orderBy: { createdAt: "asc" },
        select: { action: true },
      });

      assert.deepEqual(
        entries.map((entry) => entry.action),
        [
          "medusa.connection.credential-rotated",
          "medusa.connection.credential-rotated",
          "medusa.connection.disabled",
        ],
      );
    });
  },
);
