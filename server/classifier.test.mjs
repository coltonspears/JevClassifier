import test from "node:test";
import assert from "node:assert/strict";
import {
  ApiError,
  DECISIONS_URL,
  DEFAULT_MODEL,
  QUESTIONS,
  classifyDemo,
  classifyLive,
  parseDecision,
  routeFromScore,
  validateInput,
} from "./classifier.mjs";

export const fixture = () => ({
  id: "gen-dec-fixture",
  model: "typesafe/jev-1.13-20260917",
  answers: {
    complexity: {
      type: "score",
      score: 2.15,
      confidence: 0.77,
      legend: Object.fromEntries(
        QUESTIONS.complexity.criteria.map((value, index) => [index, value]),
      ),
      probabilities: { 4: 0, 2: 0.85, 0: 0, 3: 0.15, 1: 0 },
    },
    reasoning: { type: "noul", noul: 0.93 },
    expertise: { type: "noul", noul: 0.82 },
    constraints: { type: "noul", noul: 0.41 },
  },
  usage: { input_tokens: 510, output_tokens: 75, cost: 0.00002142 },
});

test("raw Decisions API response uses numeric probability keys, reported cost and provider confidence", () => {
  const result = parseDecision(fixture());
  assert.equal(result.complexity, 54);
  assert.equal(result.difficulty, "high");
  assert.equal(result.model, "sol");
  assert.equal(result.confidence, 0.77);
  assert.deepEqual(
    result.probabilities.map((p) => p.probability),
    [0, 0, 0.85, 0.15, 0],
  );
  assert.deepEqual(
    result.signals.map((s) => s.value),
    [93, 82, 41],
  );
  assert.deepEqual(result.usage, {
    inputTokens: 510,
    outputTokens: 75,
    costUsd: 0.00002142,
    costSource: "reported",
  });
});

test("cost fallback is explicitly estimated only for the priced Jev snapshot", () => {
  const data = fixture();
  delete data.usage.cost;
  assert.deepEqual(parseDecision(data).usage, {
    inputTokens: 510,
    outputTokens: 75,
    costUsd: (510 * 0.042) / 1_000_000,
    costSource: "estimated",
  });
  data.model = "typesafe/jev-next";
  assert.equal(parseDecision(data).usage.costUsd, null);
  assert.equal(parseDecision(data).usage.costSource, "unavailable");
  data.usage.cost = 0;
  assert.equal(parseDecision(data).usage.costSource, "reported");
  assert.equal(parseDecision(data).usage.costUsd, 0);
});

test("malformed or incomplete decision distributions are rejected, never made up", () => {
  for (const mutate of [
    (data) => {
      data.answers.complexity.score = 5;
    },
    (data) => {
      data.answers.complexity.confidence = "0.9";
    },
    (data) => {
      delete data.answers.complexity.probabilities["1"];
    },
    (data) => {
      data.answers.complexity.probabilities["2"] = 0.1;
    },
    (data) => {
      data.answers.complexity.score = 4;
    },
    (data) => {
      data.answers.reasoning.type = "choice";
    },
    (data) => {
      data.usage.input_tokens = -1;
    },
  ]) {
    const data = fixture();
    mutate(data);
    assert.throws(() => parseDecision(data), {
      code: "INVALID_DECISION",
      status: 502,
    });
  }
});

test("routing policy covers all efforts and deterministic boundary changes", () => {
  assert.deepEqual([0, 1, 2, 3, 4].map(routeFromScore), [
    { difficulty: "low", model: "luna" },
    { difficulty: "medium", model: "luna" },
    { difficulty: "high", model: "sol" },
    { difficulty: "xhigh", model: "astra" },
    { difficulty: "max", model: "astra" },
  ]);
  assert.equal(routeFromScore(1.499).model, "luna");
  assert.equal(routeFromScore(1.5).model, "sol");
  assert.equal(routeFromScore(2.5).model, "astra");
});

test("input validation prevents invalid modes, blank and oversized prompts", () => {
  for (const body of [
    null,
    [],
    { prompt: 3, mode: "demo" },
    { prompt: "   ", mode: "demo" },
    { prompt: "x".repeat(12001), mode: "demo" },
    { prompt: "valid", mode: "auto" },
  ]) {
    assert.throws(() => validateInput(body), ApiError);
  }
  assert.deepEqual(validateInput({ prompt: " hello ", mode: "demo" }), {
    prompt: "hello",
    mode: "demo",
  });
});

test("live call uses the Decisions endpoint and its typed request schema, never chat completions", async () => {
  let calls = 0;
  const result = await classifyLive("Debug the cache race condition.", {
    apiKey: "unit-test-key",
    fetchImpl: async (url, options) => {
      calls += 1;
      assert.equal(url, DECISIONS_URL);
      assert.equal(options.method, "POST");
      assert.equal(options.headers.Authorization, "Bearer unit-test-key");
      const body = JSON.parse(options.body);
      assert.equal(body.model, DEFAULT_MODEL);
      assert.deepEqual(body.state, { task: "Debug the cache race condition." });
      assert.equal(body.questions.complexity.type, "score");
      assert.equal(body.questions.complexity.criteria.length, 5);
      assert.equal(body.questions.reasoning.type, "noul");
      assert.equal(body.messages, undefined);
      return Response.json(fixture());
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.mode, "live");
  assert.equal(result.classifierModel, "typesafe/jev-1.13-20260917");
  assert.ok(result.latencyMs >= 0);
  assert.ok(!Number.isNaN(Date.parse(result.timestamp)));
});

test("upstream errors are sanitized and never fall back to demo", async () => {
  for (const [status, code] of [
    [401, "OPENROUTER_AUTH"],
    [402, "OPENROUTER_CREDITS"],
    [429, "RATE_LIMITED"],
    [503, "OPENROUTER_ERROR"],
  ]) {
    await assert.rejects(
      classifyLive("task", {
        apiKey: "unit-test-key",
        fetchImpl: async () =>
          Response.json(
            { error: { message: "secret provider details unit-test-key" } },
            { status },
          ),
      }),
      (error) => {
        assert.equal(error.code, code);
        assert.ok(!error.message.includes("unit-test-key"));
        assert.ok(!error.message.includes("secret provider"));
        return true;
      },
    );
  }
  await assert.rejects(classifyLive("task", { apiKey: "" }), {
    code: "NOT_CONFIGURED",
  });
  await assert.rejects(
    classifyLive("task", {
      apiKey: "test",
      fetchImpl: async () => new Response("not json"),
    }),
    { code: "INVALID_DECISION" },
  );
  await assert.rejects(
    classifyLive("task", {
      apiKey: "test",
      fetchImpl: async () => {
        throw new Error("private network error");
      },
    }),
    { code: "NETWORK_ERROR" },
  );
});

test("request timeout aborts upstream and reports a specific failure", async () => {
  let aborted = false;
  await assert.rejects(
    classifyLive("task", {
      apiKey: "test",
      timeoutMs: 10,
      fetchImpl: (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    }),
    { code: "TIMEOUT", status: 504 },
  );
  assert.equal(aborted, true);
});

test("demo is deterministic, explicitly synthetic, free, and differentiates simple from hard work", () => {
  const simple = classifyDemo("Translate hello to French.");
  const complex = classifyDemo(
    "Design a distributed consensus algorithm. Prove mathematical consistency, analyze fault tolerance, and verify security constraints without latency regression. Optimize the architecture and test production scalability.",
  );
  assert.ok(complex.complexity > simple.complexity);
  assert.equal(simple.model, "luna");
  assert.equal(complex.model, "astra");
  assert.equal(complex.mode, "demo");
  assert.equal(complex.usage.costSource, "simulation");
  assert.equal(complex.usage.costUsd, 0);
  assert.equal(complex.usage.inputTokens, 0);
  assert.equal(complex.complexity, classifyDemo(complex.prompt).complexity);
});
