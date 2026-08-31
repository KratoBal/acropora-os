import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { connect } from "node:net";
import { describe, it } from "node:test";

import {
  applyHttpTimeouts,
  DEFAULT_KEEP_ALIVE_TIMEOUT_MS,
  HEADERS_TIMEOUT_MARGIN_MS,
  headersTimeoutMs,
  KEEP_ALIVE_TIMEOUT_ENV,
  keepAliveTimeoutMs,
} from "./http-timeouts.js";

describe("keepAliveTimeoutMs", () => {
  it("outlasts the sixty second idle timeout proxies default to", () => {
    /**
     * The ordering is the design, so it is asserted as an ordering rather than
     * as a number. The server must be the side that does NOT close first: a
     * proxy closing an idle socket costs nothing, a server closing one the
     * proxy is about to reuse costs a request.
     */
    assert.equal(keepAliveTimeoutMs({}), DEFAULT_KEEP_ALIVE_TIMEOUT_MS);
    assert.ok(
      keepAliveTimeoutMs({}) > 60_000,
      "the server has to outlast the proxy in front of it",
    );
  });

  it("keeps the header limit above the idle limit", () => {
    // Node measures headersTimeout from when the connection goes idle, so a
    // shorter one would fire on a connection that is only waiting.
    assert.ok(headersTimeoutMs({}) > keepAliveTimeoutMs({}));
    assert.equal(
      headersTimeoutMs({}),
      DEFAULT_KEEP_ALIVE_TIMEOUT_MS + HEADERS_TIMEOUT_MARGIN_MS,
    );
  });

  it("takes a configured value, because the number in front of us is not ours", () => {
    assert.equal(
      keepAliveTimeoutMs({ [KEEP_ALIVE_TIMEOUT_ENV]: "120000" }),
      120_000,
    );
    assert.equal(
      headersTimeoutMs({ [KEEP_ALIVE_TIMEOUT_ENV]: "120000" }),
      125_000,
    );
  });

  it("falls back rather than refusing to boot on a bad value", () => {
    // A typo in a deploy variable must not take the API down: the failure
    // would look unrelated to the number somebody mistyped.
    for (const bad of ["", "  ", "abc", "-1", "0", "12.5", "9999999"]) {
      assert.equal(
        keepAliveTimeoutMs({ [KEEP_ALIVE_TIMEOUT_ENV]: bad }),
        DEFAULT_KEEP_ALIVE_TIMEOUT_MS,
        `accepted ${JSON.stringify(bad)}`,
      );
    }
  });
});

describe("applyHttpTimeouts", () => {
  it("puts both limits on a real server, not just in a variable", () => {
    /**
     * Read back off an actual `http.Server`. A computed limit that is never
     * applied leaves every other assertion in this file green while the
     * running process keeps Node's five second default - which is the exact
     * defect this file exists to prevent.
     */
    const server = createServer();

    applyHttpTimeouts(server, { [KEEP_ALIVE_TIMEOUT_ENV]: "30000" });

    assert.equal(server.keepAliveTimeout, 30_000);
    assert.equal(server.headersTimeout, 35_000);
  });

  it("actually holds an idle connection open for that long", async () => {
    /**
     * The behaviour, measured, not the property. A number assigned to the
     * right field proves nothing about what the socket does; this drives a
     * raw request through a real server and watches when the server closes
     * the connection.
     *
     * Three hundred milliseconds so the test is quick. What is asserted is
     * that the CONFIGURED value is the one in force - Node's own default
     * would have held the socket for five seconds.
     */
    const server: Server = createServer((_request, response) => {
      response.end("ok");
    });

    applyHttpTimeouts(server, { [KEEP_ALIVE_TIMEOUT_ENV]: "1000" });
    // Below the 1 000 ms minimum the reader enforces, so it is set directly:
    // the reader's floor protects production, and this measures the mechanism.
    server.keepAliveTimeout = 300;
    server.headersTimeout = 5_000;

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as { port: number };

    const closedAfterMs = await new Promise<number>((resolve, reject) => {
      const socket = connect(port, "127.0.0.1", () => {
        socket.write(
          "GET / HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\n",
        );
      });

      let answeredAt = 0;
      const guard = setTimeout(() => {
        socket.destroy();
        reject(new Error("the server never closed the idle connection"));
      }, 5_000);

      socket.on("data", () => {
        answeredAt ||= Date.now();
      });

      socket.on("close", () => {
        clearTimeout(guard);
        resolve(answeredAt ? Date.now() - answeredAt : -1);
      });

      socket.on("error", (error) => {
        clearTimeout(guard);
        reject(error);
      });
    });

    await new Promise<void>((resolve) => server.close(() => resolve()));

    assert.ok(
      closedAfterMs >= 250 && closedAfterMs < 2_000,
      `the idle socket closed ${closedAfterMs} ms after the answer, which is not the 300 ms that was set`,
    );
  });
});
