import express from "express";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  ApiError,
  DEFAULT_MODEL,
  EFFORTS,
  MAX_PROMPT_LENGTH,
  MODELS,
  CLASSIFIER_PRICING,
  PRICING_DATE,
  classifyDemo,
  classifyLive,
  validateInput,
} from "./classifier.mjs";

export function createApp({
  apiKey = "",
  model = DEFAULT_MODEL,
  fetchImpl = fetch,
  timeoutMs = 15_000,
  staticDir,
} = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use(express.json({ limit: "64kb" }));
  app.get("/api/config", (_req, res) => {
    res.json({
      configured: Boolean(apiKey.trim()),
      classifierModel: model,
      debounceMs: 300,
      maxPromptLength: MAX_PROMPT_LENGTH,
      models: MODELS,
      efforts: EFFORTS,
      classifierPricing: model === DEFAULT_MODEL ? CLASSIFIER_PRICING : null,
      pricingCheckedAt: PRICING_DATE,
    });
  });
  app.post("/api/classify", async (req, res, next) => {
    const controller = new AbortController();
    const cancel = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.once("close", cancel);
    try {
      const { prompt, mode } = validateInput(req.body);
      const decision =
        mode === "demo"
          ? classifyDemo(prompt)
          : await classifyLive(prompt, {
              apiKey,
              model,
              fetchImpl,
              timeoutMs,
              signal: controller.signal,
            });
      if (!res.destroyed) res.json(decision);
    } catch (error) {
      next(error);
    } finally {
      res.removeListener("close", cancel);
    }
  });
  app.use("/api", (_req, res) =>
    res
      .status(404)
      .json({ error: { code: "NOT_FOUND", message: "API route not found." } }),
  );
  if (staticDir && existsSync(resolve(staticDir, "index.html"))) {
    app.use(express.static(staticDir));
    app.get(/.*/, (_req, res) =>
      res.sendFile(resolve(staticDir, "index.html")),
    );
  }
  app.use((error, _req, res, _next) => {
    if (res.destroyed || res.headersSent) return;
    if (error.type === "entity.too.large")
      return res
        .status(413)
        .json({
          error: {
            code: "PAYLOAD_TOO_LARGE",
            message: "This request is too large. Use a shorter task.",
          },
        });
    if (error.type === "entity.parse.failed")
      return res
        .status(400)
        .json({
          error: {
            code: "INVALID_JSON",
            message: "Send a valid JSON request.",
          },
        });
    const known = error instanceof ApiError;
    res
      .status(known ? error.status : 500)
      .json({
        error: {
          code: known ? error.code : "INTERNAL_ERROR",
          message: known
            ? error.message
            : "The classification server encountered an error.",
        },
      });
  });
  return app;
}
