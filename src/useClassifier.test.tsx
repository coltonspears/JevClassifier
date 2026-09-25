import assert from "node:assert/strict";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { JSDOM } from "jsdom";
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { AppConfig, Classification, Mode, RequestEntry } from "./types";
import { useClassifier } from "./useClassifier";

interface PendingRequest {
  body: { prompt: string; mode: Mode };
  resolve: (response: Response) => void;
  reject: (reason: Error) => void;
}

async function mountClassifier(t: TestContext) {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost" });
  const globals = {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const descriptors = Object.keys(globals).map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  );
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }

  let now = 0;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(performance, "now", () => now);
  let config: AppConfig = {
    configured: true,
    classifierModel: "test/jev",
    debounceMs: 300,
    models: [],
  };
  const requests: PendingRequest[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (url: string | URL | Request, options?: RequestInit) => {
      if (url === "/api/config")
        return new Response(JSON.stringify(config), { status: 200 });
      assert.equal(url, "/api/classify");
      assert.equal(options?.method, "POST");
      // Once dispatched, classifications are allowed to finish and report usage.
      assert.equal(options?.signal, undefined);
      return new Promise<Response>((resolve, reject) => {
        requests.push({
          body: JSON.parse(options?.body as string),
          resolve,
          reject,
        });
      });
    },
  );

  let api!: ReturnType<typeof useClassifier>;
  function Probe() {
    api = useClassifier();
    return (
      <div>
        <output data-testid="status">{api.status}</output>
        <output data-testid="mode">{api.mode}</output>
        <output data-testid="result">{api.result?.prompt ?? ""}</output>
        <output data-testid="error">{api.error ?? ""}</output>
        <output data-testid="entries">{JSON.stringify(api.entries)}</output>
      </div>
    );
  }
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <StrictMode>
        <Probe />
      </StrictMode>,
    );
  });
  t.after(async () => {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });

  const read = (field: string) =>
    container.querySelector(`[data-testid="${field}"]`)?.textContent ?? "";
  const change = async (
    callback: (value: ReturnType<typeof useClassifier>) => void | Promise<void>,
  ) => {
    await act(async () => {
      await callback(api);
    });
  };
  const tick = async (ms: number) => {
    await act(async () => {
      now += ms;
      t.mock.timers.tick(ms);
    });
  };
  const complete = async (
    index: number,
    overrides: Partial<Classification> = {},
  ) => {
    const request = requests[index];
    const response: Classification = {
      id: `response-${index}`,
      timestamp: "2026-09-25T12:00:00Z",
      ...request.body,
      complexity: 30,
      difficulty: "medium",
      model: "luna",
      confidence: 0.9,
      probabilities: [{ level: "medium", probability: 0.9 }],
      signals: [{ name: "reasoning", value: 0.3 }],
      latencyMs: 42,
      usage: {
        inputTokens: 12,
        outputTokens: 8,
        costUsd: 0.000001,
        costSource: "reported",
      },
      classifierModel: config.classifierModel,
      ...overrides,
    };
    await act(async () => {
      request.resolve(new Response(JSON.stringify(response), { status: 200 }));
    });
  };
  const fail = async (index: number, payload: unknown) => {
    await act(async () => {
      requests[index].resolve(
        new Response(JSON.stringify(payload), { status: 502 }),
      );
    });
  };

  return {
    change,
    tick,
    read,
    complete,
    fail,
    requests,
    entries: () => JSON.parse(read("entries")) as RequestEntry[],
    configure: (next: Partial<AppConfig>) => {
      config = { ...config, ...next };
    },
    snapshot: () => api.result,
  };
}

test("StrictMode starts idle; whitespace is free; edits debounce for 300 ms", async (t) => {
  const h = await mountClassifier(t);
  assert.equal(h.read("mode"), "live");
  assert.equal(h.requests.length, 0);
  await h.change((api) => api.setPrompt(" \n\t "));
  await h.tick(1_000);
  assert.equal(h.requests.length, 0);
  assert.equal(h.read("status"), "idle");
  await h.change((api) => api.setPrompt("First draft"));
  await h.tick(299);
  assert.equal(h.requests.length, 0);
  await h.change((api) => api.setPrompt("Final draft"));
  await h.tick(299);
  assert.equal(h.requests.length, 0);
  await h.tick(1);
  assert.deepEqual(
    h.requests.map((request) => request.body),
    [{ prompt: "Final draft", mode: "live" }],
  );
  await h.tick(75);
  await h.complete(0);
  assert.equal(h.read("result"), "Final draft");
  assert.equal(h.entries()[0].roundTripMs, 75);
  assert.equal(h.entries()[0].result?.latencyMs, 42);
  assert.ok(Object.isFrozen(h.snapshot()));
  assert.ok(Object.isFrozen(h.snapshot()?.usage));
});

test("edits during a request coalesce; stale completions are counted but never presented", async (t) => {
  const h = await mountClassifier(t);
  await h.change((api) => api.setPrompt("Original"));
  await h.tick(300);
  await h.change((api) => api.setPrompt("Intermediate"));
  await h.change((api) => api.setPrompt("Latest"));
  await h.tick(400);
  assert.equal(
    h.requests.length,
    1,
    "only one upstream request may be in flight",
  );
  await h.change((api) => api.clearHistory());
  assert.equal(h.entries().length, 1, "pending usage must not disappear");
  await h.complete(0);
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].body.prompt, "Latest");
  assert.equal(h.read("result"), "");
  assert.deepEqual(
    h.entries().map((entry) => entry.status),
    ["success", "pending"],
  );
  await h.complete(1);
  assert.equal(h.read("result"), "Latest");
  assert.deepEqual(
    h.entries().map((entry) => entry.result?.prompt),
    ["Original", "Latest"],
  );
});

test("switching modes invalidates a dispatched result and preserves each mode in history", async (t) => {
  const h = await mountClassifier(t);
  await h.change((api) => api.setPrompt("Explain recursion"));
  await h.tick(300);
  await h.change((api) => api.setMode("demo"));
  await h.tick(300);
  await h.complete(0);
  assert.equal(h.read("mode"), "demo");
  assert.equal(h.read("result"), "");
  assert.equal(h.requests[1].body.mode, "demo");
  await h.complete(1);
  assert.deepEqual(
    h.entries().map((entry) => entry.mode),
    ["live", "demo"],
  );
  await h.change((api) => api.clearHistory());
  assert.deepEqual(
    h.entries().map((entry) => entry.mode),
    ["live"],
    "clear affects the visible mode only",
  );
  await h.change((api) => {
    api.setLive(false);
    api.setMode("live");
    api.clearHistory();
  });
  assert.equal(h.entries().length, 0);
});

test("pausing prevents new calls and resume classifies only the newest editor value", async (t) => {
  const h = await mountClassifier(t);
  await h.change((api) => api.setPrompt("Before pause"));
  await h.tick(300);
  await h.change((api) => {
    api.setLive(false);
    api.setPrompt("Edited while paused");
  });
  await h.tick(500);
  await h.complete(0);
  assert.equal(h.read("result"), "");
  assert.equal(h.read("status"), "idle");
  assert.equal(h.requests.length, 1);
  assert.equal(h.entries()[0].status, "success");
  await h.change((api) => api.setLive(true));
  await h.tick(299);
  assert.equal(h.requests.length, 1);
  await h.tick(1);
  assert.equal(h.requests[1].body.prompt, "Edited while paused");
  await h.complete(1);
  assert.equal(h.read("result"), "Edited while paused");
});

test("errors are recorded; retry resends unchanged input; stale errors cannot overwrite new work", async (t) => {
  const h = await mountClassifier(t);
  await h.change((api) => api.setPrompt("Retry me"));
  await h.tick(300);
  await h.fail(0, { error: { message: "Upstream unavailable" } });
  assert.equal(h.read("status"), "error");
  assert.equal(h.read("error"), "Upstream unavailable");
  await h.change((api) => api.retry());
  await h.tick(300);
  assert.equal(h.requests[1].body.prompt, "Retry me");
  await h.change((api) => api.setPrompt("New task"));
  await h.tick(300);
  await h.fail(1, { error: "Old task failed" });
  assert.equal(h.read("error"), "");
  assert.equal(h.read("status"), "classifying");
  assert.equal(h.requests[2].body.prompt, "New task");
  await h.complete(2);
  assert.equal(h.read("result"), "New task");
  assert.deepEqual(
    h.entries().map((entry) => entry.status),
    ["error", "error", "success"],
  );
});

test("refreshing unchanged configuration cannot duplicate pending or completed billed requests", async (t) => {
  const h = await mountClassifier(t);
  await h.change((api) => api.setPrompt("Keep this route"));
  await h.tick(300);
  await h.change((api) => api.reloadConfig());
  await h.tick(300);
  await h.complete(0);
  await h.tick(500);
  assert.equal(h.requests.length, 1);
  assert.equal(h.read("result"), "Keep this route");
  h.configure({ debounceMs: 200 });
  await h.change((api) => api.reloadConfig());
  await h.tick(500);
  assert.equal(
    h.requests.length,
    1,
    "a debounce change alone does not invalidate a completed route",
  );
  h.configure({ classifierModel: "test/new-jev" });
  await h.change((api) => api.reloadConfig());
  await h.tick(200);
  assert.equal(
    h.requests.length,
    2,
    "an actual classifier change should update the route",
  );
  await h.complete(1);
});

test("erasing input during a request retains its accounting without reviving its route", async (t) => {
  const h = await mountClassifier(t);
  await h.change((api) => api.setPrompt("Erase this"));
  await h.tick(300);
  await h.change((api) => api.setPrompt("\n   "));
  await h.complete(0);
  await h.tick(500);
  assert.equal(h.requests.length, 1);
  assert.equal(h.read("result"), "");
  assert.equal(h.read("status"), "idle");
  assert.equal(h.entries()[0].status, "success");
  await h.change((api) => api.setPrompt("x".repeat(12_001)));
  await h.tick(500);
  assert.equal(h.requests.length, 1);
  assert.equal(h.read("status"), "error");
  assert.match(h.read("error"), /12,000/);
});

test("choosing demo explicitly survives connection refreshes", async (t) => {
  const h = await mountClassifier(t);
  await h.change((api) => api.setMode("demo"));
  await h.change((api) => api.setPrompt("Stay simulated"));
  await h.tick(300);
  await h.complete(0);
  h.configure({ configured: false });
  await h.change((api) => api.reloadConfig());
  h.configure({ configured: true });
  await h.change((api) => api.reloadConfig());
  await h.tick(500);
  assert.equal(h.read("mode"), "demo");
  assert.equal(h.requests.length, 1);
  assert.equal(h.read("result"), "Stay simulated");
});
