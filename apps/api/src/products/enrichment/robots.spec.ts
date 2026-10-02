import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseRobots, robotsAllows } from "./robots.js";

describe("robots.txt", () => {
  const text = `# kitalált
User-agent: *
Disallow: /search
Disallow: /checkout
Allow: /search/help
Crawl-delay: 10

User-agent: AcroporaOS-JEV
Disallow: /private/
Allow: /private/public$
`;

  it("a saját csoportunk nyer a *-gal szemben", () => {
    const rules = parseRobots(text, "AcroporaOS-JEV");
    assert.equal(robotsAllows(rules, "/search?q=x"), true);
    assert.equal(robotsAllows(rules, "/private/x"), false);
    assert.equal(robotsAllows(rules, "/private/public"), true);
    assert.equal(robotsAllows(rules, "/private/public/more"), false);
  });

  it("a * csoport: a leghosszabb illeszkedés dönt, döntetlennél az Allow", () => {
    const rules = parseRobots(text, "MasikRobot");
    assert.equal(robotsAllows(rules, "/search?q=1"), false);
    assert.equal(robotsAllows(rules, "/search/help"), true);
    assert.equal(robotsAllows(rules, "/p/123"), true);
    assert.equal(rules.crawlDelaySeconds, 10);
  });

  it("csillag és $ a mintában; az üres Disallow nem tilt", () => {
    const rules = parseRobots(
      "User-agent: *\nDisallow: /*.pdf$\nDisallow:\n",
      "x",
    );
    assert.equal(robotsAllows(rules, "/doc/a.pdf"), false);
    assert.equal(robotsAllows(rules, "/doc/a.pdf?x"), true);
    assert.equal(robotsAllows(rules, "/"), true);
  });

  it("csoport nélkül minden engedett", () => {
    assert.equal(robotsAllows(parseRobots("", "x"), "/x"), true);
  });
});
