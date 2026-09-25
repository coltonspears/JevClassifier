import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { AppConfig, Classification, Mode, RequestEntry } from "./types";

type Status = "idle" | "debouncing" | "classifying" | "success" | "error";
type Input = { prompt: string; mode: Mode; live: boolean; revision: number };
type QueuedRequest = Pick<Input, "prompt" | "mode" | "revision"> & {
  dueAt: number;
};

function errorMessage(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    if ("error" in value) return errorMessage(value.error);
    if ("message" in value && typeof value.message === "string")
      return value.message;
  }
  return "The request could not be completed. Please try again.";
}

// A completed response is a snapshot: request history must not change when the
// editor, route, or subsequent response changes.
function freezeSnapshot<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeSnapshot);
    Object.freeze(value);
  }
  return value;
}

function isClassification(value: unknown): value is Classification {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Classification>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.complexity === "number" &&
    typeof candidate.confidence === "number" &&
    typeof candidate.latencyMs === "number" &&
    ["luna", "sol", "astra"].includes(candidate.model ?? "") &&
    ["low", "medium", "high", "xhigh", "max"].includes(
      candidate.difficulty ?? "",
    ) &&
    Array.isArray(candidate.probabilities) &&
    Array.isArray(candidate.signals) &&
    !!candidate.usage &&
    typeof candidate.usage.inputTokens === "number" &&
    typeof candidate.usage.outputTokens === "number"
  );
}

export function useClassifier() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [prompt, setPromptState] = useState("");
  const [mode, setModeState] = useState<Mode>("demo");
  const [live, setLiveState] = useState(true);
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<Classification | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Keep all requests for the current browser session so spend never silently
  // falls out of the analytics. Clear history explicitly to start a new session.
  const [entries, setEntries] = useState<RequestEntry[]>([]);

  const mounted = useRef(false);
  const input = useRef<Input>({
    prompt: "",
    mode: "demo",
    live: true,
    revision: 0,
  });
  const configRef = useRef<AppConfig | null>(null);
  const modeWasChosen = useRef(false);
  const queued = useRef<QueuedRequest | null>(null);
  const inFlight = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const configController = useRef<AbortController | null>(null);
  const configGeneration = useRef(0);
  const drain = useRef<() => void>(() => {});

  const cancelTimer = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const dispatch = useCallback(async (request: QueuedRequest) => {
    const requestId = crypto.randomUUID();
    const startedAt = performance.now();
    const isCurrent = () =>
      mounted.current &&
      input.current.live &&
      input.current.revision === request.revision;

    inFlight.current = requestId;
    setStatus("classifying");
    setEntries((previous) => [
      ...previous,
      {
        id: requestId,
        timestamp: new Date().toISOString(),
        mode: request.mode,
        prompt: request.prompt,
        status: "pending",
      },
    ]);

    try {
      // Do not cancel dispatched classifications when input changes: an upstream
      // call can already be billed. Let the server enforce its request timeout,
      // record the outcome, then send the latest coalesced editor value.
      const response = await fetch("/api/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: request.prompt, mode: request.mode }),
      });
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new Error(
          `The server returned an unreadable response (${response.status}).`,
        );
      }
      if (!response.ok) throw new Error(errorMessage(payload));
      if (!isClassification(payload))
        throw new Error(
          "The server returned an incomplete classification. Please try again.",
        );

      const snapshot = freezeSnapshot(payload);
      const roundTripMs = Math.round(performance.now() - startedAt);
      if (mounted.current) {
        setEntries((previous) =>
          previous.map((entry) =>
            entry.id === requestId
              ? { ...entry, status: "success", result: snapshot, roundTripMs }
              : entry,
          ),
        );
      }
      if (isCurrent()) {
        setResult(snapshot);
        setError(null);
        setStatus("success");
      }
    } catch (cause) {
      const message = errorMessage(cause);
      const roundTripMs = Math.round(performance.now() - startedAt);
      if (mounted.current) {
        setEntries((previous) =>
          previous.map((entry) =>
            entry.id === requestId
              ? { ...entry, status: "error", error: message, roundTripMs }
              : entry,
          ),
        );
      }
      if (isCurrent()) {
        setResult(null);
        setError(message);
        setStatus("error");
      }
    } finally {
      inFlight.current = null;
      drain.current();
    }
  }, []);

  drain.current = () => {
    if (!mounted.current || inFlight.current || !queued.current) return;
    cancelTimer();
    const request = queued.current;
    if (!input.current.live || request.revision !== input.current.revision) {
      queued.current = null;
      return;
    }
    const remaining = request.dueAt - performance.now();
    if (remaining > 0) {
      timer.current = setTimeout(() => drain.current(), remaining);
      return;
    }
    queued.current = null;
    void dispatch(request);
  };

  const scheduleLatest = useCallback(() => {
    cancelTimer();
    queued.current = null;
    if (!mounted.current) return;
    setResult(null);
    setError(null);

    const latest = input.current;
    if (!latest.live || !latest.prompt.trim() || !configRef.current) {
      setStatus("idle");
      return;
    }
    if (latest.prompt.length > 12_000) {
      setStatus("error");
      setError("Keep the task to 12,000 characters or fewer.");
      return;
    }
    if (latest.mode === "live" && !configRef.current.configured) {
      setStatus("error");
      setError(
        "Add an OpenRouter API key to .env and reload the connection to use live Jev.",
      );
      return;
    }

    const delay = Number.isFinite(configRef.current.debounceMs)
      ? Math.max(0, configRef.current.debounceMs)
      : 300;
    queued.current = {
      prompt: latest.prompt,
      mode: latest.mode,
      revision: latest.revision,
      dueAt: performance.now() + delay,
    };
    setStatus("debouncing");
    drain.current();
  }, [cancelTimer]);

  const setPrompt: Dispatch<SetStateAction<string>> = useCallback(
    (value) => {
      const next =
        typeof value === "function" ? value(input.current.prompt) : value;
      if (next === input.current.prompt) return;
      input.current = {
        ...input.current,
        prompt: next,
        revision: input.current.revision + 1,
      };
      setPromptState(next);
      scheduleLatest();
    },
    [scheduleLatest],
  );

  const setMode: Dispatch<SetStateAction<Mode>> = useCallback(
    (value) => {
      modeWasChosen.current = true;
      const next =
        typeof value === "function" ? value(input.current.mode) : value;
      if (next === input.current.mode) return;
      input.current = {
        ...input.current,
        mode: next,
        revision: input.current.revision + 1,
      };
      setModeState(next);
      scheduleLatest();
    },
    [scheduleLatest],
  );

  const setLive: Dispatch<SetStateAction<boolean>> = useCallback(
    (value) => {
      const next =
        typeof value === "function" ? value(input.current.live) : value;
      if (next === input.current.live) return;
      input.current = {
        ...input.current,
        live: next,
        revision: input.current.revision + 1,
      };
      setLiveState(next);
      scheduleLatest();
    },
    [scheduleLatest],
  );

  const retry = useCallback(() => {
    input.current = { ...input.current, revision: input.current.revision + 1 };
    scheduleLatest();
  }, [scheduleLatest]);

  const clearHistory = useCallback(() => {
    // Never erase a pending call; its response and possible charge still belong
    // in the session ledger.
    if (inFlight.current) return;
    const currentMode = input.current.mode;
    setEntries((previous) =>
      previous.filter((entry) => entry.mode !== currentMode),
    );
  }, []);

  const reloadConfig = useCallback(async () => {
    configController.current?.abort();
    const controller = new AbortController();
    configController.current = controller;
    const generation = ++configGeneration.current;
    setConfigError(null);
    try {
      const response = await fetch("/api/config", {
        signal: controller.signal,
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(errorMessage(payload));
      if (
        !payload ||
        typeof payload !== "object" ||
        !("configured" in payload) ||
        typeof payload.configured !== "boolean" ||
        !("models" in payload) ||
        !Array.isArray(payload.models)
      ) {
        throw new Error("The server returned an invalid configuration.");
      }
      if (!mounted.current || generation !== configGeneration.current) return;
      const next = payload as AppConfig;
      const previous = configRef.current;
      configRef.current = next;
      setConfig(next);
      const nextMode = modeWasChosen.current
        ? input.current.mode
        : next.configured
          ? "live"
          : "demo";
      const routingChanged =
        !previous ||
        nextMode !== input.current.mode ||
        previous.classifierModel !== next.classifierModel ||
        (nextMode === "live" && previous.configured !== next.configured);
      if (routingChanged) {
        input.current = {
          ...input.current,
          mode: nextMode,
          revision: input.current.revision + 1,
        };
        setModeState(nextMode);
        scheduleLatest();
      } else if (queued.current && previous.debounceMs !== next.debounceMs) {
        // A connection refresh must not duplicate an already dispatched (and
        // potentially billed) classification when routing is unchanged.
        scheduleLatest();
      }
    } catch (cause) {
      if (
        controller.signal.aborted ||
        !mounted.current ||
        generation !== configGeneration.current
      )
        return;
      setConfigError(errorMessage(cause));
    }
  }, [scheduleLatest]);

  useEffect(() => {
    mounted.current = true;
    void reloadConfig();
    return () => {
      mounted.current = false;
      configController.current?.abort();
      cancelTimer();
      queued.current = null;
    };
  }, [cancelTimer, reloadConfig]);

  return {
    config,
    configError,
    prompt,
    setPrompt,
    mode,
    setMode,
    live,
    setLive,
    status,
    result,
    error,
    entries,
    clearHistory,
    retry,
    reloadConfig,
  };
}
