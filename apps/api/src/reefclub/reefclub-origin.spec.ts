import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { crossSiteRefusal, webOriginOf } from "./reefclub-origin.js";
import {
  reefClubCallerAddress,
  trustedProxyHops,
} from "./reefclub-rate-limits.js";

const WEB = "https://reefclub.example";
const JSON_BODY = { "content-type": "application/json", "content-length": "2" };

describe("ReefClub kereszt-oldali ellenőrzés (barracuda #1717 A)", () => {
  it("idegen Origin-nel a nyilvános POST is elutasítva", () => {
    assert.equal(
      crossSiteRefusal(
        {
          method: "POST",
          headers: { origin: "https://tamado.example", ...JSON_BODY },
        },
        WEB,
      )?.kind,
      "origin",
    );
  });

  it("a null Origin (sandbox, fájl) is idegen", () => {
    assert.equal(
      crossSiteRefusal(
        { method: "POST", headers: { origin: "null", ...JSON_BODY } },
        WEB,
      )?.kind,
      "origin",
    );
  });

  it("a saját Origin JSON törzzsel átmegy", () => {
    assert.equal(
      crossSiteRefusal(
        { method: "POST", headers: { origin: WEB, ...JSON_BODY } },
        WEB,
      ),
      null,
    );
  });

  it("Origin nélkül a Sec-Fetch-Site dönt: a same-site (testvér aldomain) is idegen", () => {
    for (const site of ["cross-site", "same-site"])
      assert.equal(
        crossSiteRefusal(
          { method: "POST", headers: { "sec-fetch-site": site, ...JSON_BODY } },
          WEB,
        )?.kind,
        "origin",
        site,
      );
    for (const site of ["same-origin", "none"])
      assert.equal(
        crossSiteRefusal(
          { method: "POST", headers: { "sec-fetch-site": site, ...JSON_BODY } },
          WEB,
        ),
        null,
        site,
      );
  });

  it("űrlap-kódolású törzs saját Origin-nel is elutasítva", () => {
    for (const type of [
      "application/x-www-form-urlencoded",
      "multipart/form-data; boundary=x",
      "text/plain",
    ])
      assert.equal(
        crossSiteRefusal(
          {
            method: "POST",
            headers: {
              origin: WEB,
              "content-type": type,
              "content-length": "10",
            },
          },
          WEB,
        )?.kind,
        "media-type",
        type,
      );
  });

  it("törzs nélküli POST (kilépés) típus nélkül is átmegy; a GET-et nem nézi", () => {
    assert.equal(
      crossSiteRefusal({ method: "POST", headers: { origin: WEB } }, WEB),
      null,
    );
    assert.equal(
      crossSiteRefusal(
        { method: "GET", headers: { origin: "https://tamado.example" } },
        WEB,
      ),
      null,
    );
  });

  it("a webcímből csak az origin számít", () => {
    assert.equal(webOriginOf("https://reefclub.example/akarmi/"), WEB);
  });
});

describe("ReefClub hívó-cím (barracuda #1717 B)", () => {
  const request = (xff: string | undefined) => ({
    headers: xff === undefined ? {} : { "x-forwarded-for": xff },
    ip: "10.0.0.9",
  });

  it("a kliens írta első elemet nem hiszi el: jobbról a hop-számadik a cím", () => {
    assert.equal(
      reefClubCallerAddress(request("6.6.6.6, 203.0.113.7"), 1),
      "203.0.113.7",
    );
    assert.equal(
      reefClubCallerAddress(request("6.6.6.6, 203.0.113.7, 10.0.0.2"), 2),
      "203.0.113.7",
    );
  });

  it("két különböző hamis első elem ugyanarra a kulcsra esik", () => {
    assert.equal(
      reefClubCallerAddress(request("1.1.1.1, 203.0.113.7"), 1),
      reefClubCallerAddress(request("2.2.2.2, 203.0.113.7"), 1),
    );
  });

  it("kevesebb elem, mint a hop-szám, vagy fejléc nélkül: a socket címe, soha nem kliens-elem", () => {
    assert.equal(reefClubCallerAddress(request("6.6.6.6"), 2), "10.0.0.9");
    assert.equal(reefClubCallerAddress(request(undefined), 1), "10.0.0.9");
    assert.equal(reefClubCallerAddress(request("6.6.6.6"), 0), "10.0.0.9");
  });

  it("a hop-szám beállítása: alap 1, érvénytelen érték is 1", () => {
    assert.equal(trustedProxyHops({}), 1);
    assert.equal(trustedProxyHops({ REEFCLUB_TRUSTED_PROXY_HOPS: "2" }), 2);
    assert.equal(trustedProxyHops({ REEFCLUB_TRUSTED_PROXY_HOPS: "x" }), 1);
    assert.equal(trustedProxyHops({ REEFCLUB_TRUSTED_PROXY_HOPS: "-1" }), 1);
  });
});
