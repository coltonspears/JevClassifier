import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "./app.mjs";

async function withServer(options, run) {
  const server = createApp(options).listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(url);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

const post = (base, body) =>
  fetch(`${base}/api/classify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

test("config discloses only safe settings and demo works without contacting OpenRouter", async () => {
  let upstreamCalls = 0;
  await withServer(
    {
      apiKey: "never-return-this",
      fetchImpl: async () => {
        upstreamCalls += 1;
        throw new Error("Unexpected upstream call");
      },
    },
    async (url) => {
      const configResponse = await fetch(`${url}/api/config`);
      const configText = await configResponse.text();
      assert.ok(!configText.includes("never-return-this"));
      const config = JSON.parse(configText);
      assert.equal(config.configured, true);
      assert.equal(config.debounceMs, 300);
      assert.deepEqual(
        config.models.map((model) => model.key),
        ["luna", "sol", "astra"],
      );
      assert.equal(configResponse.headers.get("cache-control"), "no-store");
      const response = await post(url, {
        prompt: "Write a friendly greeting.",
        mode: "demo",
      });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).mode, "demo");
      assert.equal(upstreamCalls, 0);
    },
  );
});

test("HTTP validation and missing-key errors are structured", async () => {
  await withServer({}, async (url) => {
    for (const [body, expectedStatus, expectedCode] of [
      [{ prompt: "", mode: "demo" }, 400, "INVALID_PROMPT"],
      [{ prompt: "hello", mode: "bad" }, 400, "INVALID_MODE"],
      ["{invalid", 400, "INVALID_JSON"],
      [{ prompt: "hello", mode: "live" }, 503, "NOT_CONFIGURED"],
      [{ prompt: "x".repeat(70_000), mode: "demo" }, 413, "PAYLOAD_TOO_LARGE"],
    ]) {
      const response = await post(url, body);
      assert.equal(response.status, expectedStatus);
      assert.equal((await response.json()).error.code, expectedCode);
    }
    assert.equal((await fetch(`${url}/api/missing`)).status, 404);
  });
});
