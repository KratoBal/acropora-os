import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { CreateAquariumDto, UpdateAquariumDto } from "./aquarium.dto.js";
import {
  addressIsBlank,
  CreateAquariumCustomerDto,
} from "./aquarium-customer.dto.js";

/**
 * AZ AKVÁRIUMHOZ FELVITT ÚJ ÜGYFÉL: CSAK A NÉV KÖTELEZŐ (Luca, task
 * os-ugyfel-akvarium-hianyos). MI PIROSÍT: ha a név nélküli ügyfél átmegy;
 * ha az üres e-mail, az üres irányítószám vagy az üresen elküldött cím-sor
 * (a webes űrlap ilyet küld) hibát ad; ha a részben kitöltött cím elveszik
 * vagy hibát ad; ha egy ROSSZ e-mail már nem bukik; ha az akvárium DTO-ja nem
 * ezt az osztályt használja (a felvitel és az Ügyfelek lap szétválása).
 */
const parse = async (plain: Record<string, unknown>) => {
  const instance = plainToInstance(CreateAquariumCustomerDto, plain);
  return { instance, errors: await validate(instance) };
};
const aquarium = (newCustomer: Record<string, unknown>) => ({
  ownershipType: "CUSTOMER",
  name: "Nappali",
  newCustomer,
});

describe("az akváriumhoz felvitt új ügyfél", () => {
  it("csak a névvel és típussal érvényes, az üres mezők hiányzónak számítanak", async () => {
    const { instance, errors } = await parse({
      type: "PERSON",
      displayName: "  Kovács Anna  ",
      email: "",
      phone: "   ",
      companyName: "",
      taxNumber: "",
      addresses: [{ type: "OTHER", postalCode: "", city: "", line1: "" }],
    });
    assert.equal(errors.length, 0, JSON.stringify(errors));
    assert.equal(instance.displayName, "Kovács Anna");
    assert.equal(instance.email, undefined);
    assert.equal(instance.phone, undefined);
    assert.equal(instance.companyName, undefined);
    assert.equal(instance.taxNumber, undefined);
    // a teljesen üres cím-sor eldobódik
    assert.deepEqual(instance.addresses, []);
  });

  it("a név kötelező, szóközök nem számítanak névnek", async () => {
    for (const displayName of [undefined, "", "   "]) {
      const { errors } = await parse({ type: "PERSON", displayName });
      assert.ok(
        errors.some((e) => e.property === "displayName"),
        String(displayName),
      );
    }
  });

  it("a megadott e-mailnek érvényesnek kell lennie", async () => {
    const rossz = await parse({
      type: "PERSON",
      displayName: "A",
      email: "nem-email",
    });
    assert.ok(rossz.errors.some((e) => e.property === "email"));
    const jo = await parse({
      type: "PERSON",
      displayName: "A",
      email: " anna@example.com ",
    });
    assert.equal(jo.errors.length, 0);
    assert.equal(jo.instance.email, "anna@example.com");
  });

  it("a részben kitöltött cím megmarad, a hiányzó rész üres szöveg (irányítószám nélkül is)", async () => {
    const { instance, errors } = await parse({
      type: "PERSON",
      displayName: "A",
      addresses: [
        { type: "OTHER", postalCode: "", city: "Győr", line1: "Fő u. 1." },
      ],
    });
    assert.equal(errors.length, 0, JSON.stringify(errors));
    assert.equal(instance.addresses.length, 1);
    assert.deepEqual(
      [
        instance.addresses[0]!.postalCode,
        instance.addresses[0]!.city,
        instance.addresses[0]!.line1,
      ],
      ["", "Győr", "Fő u. 1."],
    );
    // a hiányzó mező (nem csak az üres) is üres szövegre esik
    const hianyzo = await parse({
      type: "PERSON",
      displayName: "A",
      addresses: [{ type: "OTHER", line1: "Fő u. 1." }],
    });
    assert.equal(hianyzo.errors.length, 0);
    assert.equal(hianyzo.instance.addresses[0]!.postalCode, "");
  });

  it("a teljes cím és a teljes adatsor változatlanul átmegy", async () => {
    const { instance, errors } = await parse({
      type: "COMPANY",
      displayName: "Kft.",
      companyName: "Példa Kft.",
      taxNumber: "12345678-2-42",
      email: "kft@example.com",
      phone: "+36 1 234 5678",
      addresses: [
        {
          type: "BILLING",
          postalCode: "1011",
          city: "Budapest",
          line1: "Fő utca 1.",
          isDefault: true,
        },
      ],
    });
    assert.equal(errors.length, 0);
    assert.equal(instance.addresses[0]!.postalCode, "1011");
    assert.equal(instance.companyName, "Példa Kft.");
  });

  it("a cím-sor üressége a három fő részből dől el", () => {
    assert.equal(
      addressIsBlank({ postalCode: "", city: " ", line1: undefined }),
      true,
    );
    assert.equal(addressIsBlank({}), true);
    assert.equal(addressIsBlank(undefined), true);
    for (const rész of ["postalCode", "city", "line1"])
      assert.equal(addressIsBlank({ [rész]: "x" }), false, rész);
  });

  it("a létrehozás és a módosítás DTO-ja is ezt az osztályt használja", async () => {
    for (const Dto of [CreateAquariumDto, UpdateAquariumDto]) {
      const instance = plainToInstance(
        Dto as typeof CreateAquariumDto,
        aquarium({ type: "PERSON", displayName: "Béla", email: "" }),
      );
      const errors = await validate(instance, { whitelist: false });
      assert.ok(
        !errors.some((e) => e.property === "newCustomer"),
        JSON.stringify(errors),
      );
      assert.ok(instance.newCustomer instanceof CreateAquariumCustomerDto);
    }
  });
});
