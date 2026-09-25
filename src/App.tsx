import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  Code2,
  Copy,
  Cpu,
  ExternalLink,
  Layers3,
  Tag,
  Moon,
  Orbit,
  RotateCcw,
  Settings2,
  Sun,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { useClassifier } from "./useClassifier";
import type {
  Classification,
  Difficulty,
  ModelKey,
  RequestEntry,
} from "./types";

const modelMeta = {
  luna: { name: "Luna", subtitle: "Low · Medium", Icon: Moon },
  sol: { name: "Sol", subtitle: "High", Icon: Sun },
  astra: { name: "Astra", subtitle: "X-high · Max", Icon: Orbit },
};
const levels: Difficulty[] = ["low", "medium", "high", "xhigh", "max"];
const levelNames: Record<Difficulty, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "X-high",
  max: "Max",
};
const examples = [
  {
    name: "Simple question",
    icon: Zap,
    prompt: "What is the capital of Portugal? Give me a one-sentence answer.",
  },
  {
    name: "Coding task",
    icon: Code2,
    prompt:
      "Write a TypeScript function that groups a list of transactions by month, calculates the monthly total, and handles missing dates. Include a few test cases.",
  },
  {
    name: "System design",
    icon: Orbit,
    prompt:
      "Design a globally distributed payment system that guarantees exactly-once settlement across unreliable networks. Analyze consistency versus availability, prove the safety invariants of your protocol, and develop a failure recovery strategy for simultaneous region outages with adversarial message ordering.",
  },
];

function money(value: number | null | undefined) {
  if (value == null) return "—";
  if (value === 0) return "$0.00";
  return `$${value.toFixed(value < 0.001 ? 8 : value < 0.1 ? 6 : 4)}`;
}
function time(value: number | undefined) {
  return value == null ? "—" : value < 1 ? "<1" : `${Math.round(value)}`;
}
function percentile(values: number[], fraction: number) {
  if (!values.length) return undefined;
  return [...values].sort((a, b) => a - b)[
    Math.ceil(values.length * fraction) - 1
  ];
}

function JevMark({ small = false }: { small?: boolean }) {
  return (
    <svg
      className={small ? "jev-mark small" : "jev-mark"}
      viewBox="0 0 40 40"
      aria-hidden="true"
    >
      <path
        d="M10 10h8v12a6 6 0 0 0 12 0V10"
        fill="none"
        stroke="currentColor"
        strokeWidth="4.5"
        strokeLinecap="round"
      />
      <circle cx="10" cy="29" r="3" fill="currentColor" />
    </svg>
  );
}

function RoutingMap({
  result,
  busy,
}: {
  result: Classification | null;
  busy: boolean;
}) {
  return (
    <div className={`routing-map ${busy ? "routing-busy" : ""}`}>
      <svg
        className="route-wires"
        viewBox="0 0 620 300"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path className="wire input-wire" d="M0 150 H135" />
        {(["luna", "sol", "astra"] as ModelKey[]).map((model, i) => (
          <g key={model}>
            <path
              className={`wire ${result?.model === model ? `wire-active ${model}` : ""}`}
              d={`M190 150 H245 C290 150 270 ${58 + i * 92} 330 ${58 + i * 92} H380`}
            />
            {result?.model === model && (
              <circle key={result.id} className={`wire-dot ${model}`} r="4">
                <animateMotion
                  dur="1.3s"
                  repeatCount="2"
                  fill="freeze"
                  path={`M190 150 H245 C290 150 270 ${58 + i * 92} 330 ${58 + i * 92} H380`}
                />
              </circle>
            )}
          </g>
        ))}
      </svg>
      <div className="jev-core">
        <div className="core-ring" />
        <div className="core-center">
          <JevMark />
          <strong>Jev</strong>
        </div>
        <span className="core-caption">Classifier</span>
      </div>
      <div className="model-stack">
        {(Object.keys(modelMeta) as ModelKey[]).map((key) => {
          const { name, subtitle, Icon } = modelMeta[key];
          const selected = result?.model === key;
          return (
            <div
              key={key}
              className={`model-node ${key} ${selected ? "selected" : ""}`}
            >
              <div className="model-icon">
                <Icon size={23} strokeWidth={1.6} />
              </div>
              <div className="model-name">
                <strong>
                  {name}
                  <span>GPT-6</span>
                </strong>
                <span>{subtitle}</span>
              </div>
              {selected ? (
                <span className="selected-check" aria-label="Selected model">
                  <Check size={15} />
                </span>
              ) : (
                <span className="node-terminal" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LatencyChart({ entries }: { entries: RequestEntry[] }) {
  const completed = entries
    .filter((e) => e.status === "success" && e.result)
    .slice(-30);
  const values = completed.map((e) => e.result!.latencyMs);
  const maxValue = Math.max(...values, 0);
  const tickStep =
    maxValue < 1 ? 0.5 : maxValue < 10 ? 1 : maxValue < 100 ? 10 : 100;
  const ceiling = values.length
    ? Math.max(
        tickStep * 2,
        Math.ceil(maxValue / (tickStep * 2)) * tickStep * 2,
      )
    : 100;
  const x = (index: number) =>
    6 + index * (586 / Math.max(completed.length - 1, 1));
  const y = (value: number) => 126 - (value / ceiling) * 105;
  const points = values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  return (
    <div className="latency-chart">
      <div className="chart-axis-y" aria-hidden="true">
        <span>{ceiling}</span>
        <span>{ceiling / 2}</span>
        <span>0</span>
      </div>
      <svg
        viewBox="0 0 600 156"
        preserveAspectRatio="none"
        role="img"
        aria-label={
          values.length
            ? `Classification latency in milliseconds for the last ${values.length} successful requests. Range ${Math.min(...values)} to ${Math.max(...values)} milliseconds.`
            : "Classification latency chart. No completed requests yet."
        }
      >
        <defs>
          <linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8270ef" stopOpacity="0.17" />
            <stop offset="100%" stopColor="#8270ef" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((f) => (
          <line
            key={f}
            x1="6"
            x2="592"
            y1={y(f * ceiling)}
            y2={y(f * ceiling)}
            className="chart-grid"
          />
        ))}
        {values.length > 1 && (
          <>
            <polygon
              points={`6,126 ${points} ${x(values.length - 1)},126`}
              fill="url(#chart-fill)"
            />
            <polyline
              points={points}
              fill="none"
              stroke="#8270ef"
              strokeWidth="2.5"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </>
        )}
        {completed.map((e, i) => (
          <circle
            key={e.id}
            cx={x(i)}
            cy={y(values[i])}
            r="4"
            fill="#8270ef"
            stroke="white"
            strokeWidth="2"
          >
            <title>{`Request ${i + 1}: ${values[i]} ms`}</title>
          </circle>
        ))}
      </svg>
      <div className="chart-axis-x" aria-hidden="true">
        <span>{completed.length ? "Oldest" : ""}</span>
        <span>{completed.length ? "Newest" : ""}</span>
      </div>
      {!values.length && (
        <div className="chart-empty">
          <Activity size={19} />
          <span>No requests yet</span>
        </div>
      )}
    </div>
  );
}

function Analytics({
  entries,
  demo,
  onClear,
}: {
  entries: RequestEntry[];
  demo: boolean;
  onClear: () => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const successful = entries.filter((e) => e.status === "success" && e.result);
  const failures = entries.filter((e) => e.status === "error").length;
  const pending = entries.filter((e) => e.status === "pending").length;
  const latencies = successful.map((e) => e.result!.latencyMs);
  const costs = successful.map((e) => e.result!.usage.costUsd);
  const total = costs.reduce<number>((sum, v) => sum + (v ?? 0), 0);
  const unknownCost = !demo && (failures > 0 || costs.some((v) => v == null));
  const mean = latencies.length
    ? latencies.reduce((a, b) => a + b, 0) / latencies.length
    : undefined;
  const estimated = successful.some(
    (e) => e.result!.usage.costSource === "estimated",
  );
  const counts = (Object.keys(modelMeta) as ModelKey[]).map((model) => ({
    model,
    count: successful.filter((e) => e.result?.model === model).length,
  }));
  const exportData = () => {
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            {
              exportedAt: new Date().toISOString(),
              mode: demo ? "demo" : "live",
              entries,
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `jev-${demo ? "simulation" : "live"}-session.json`;
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <section
      className="analytics"
      id="analytics"
      aria-labelledby="analytics-title"
    >
      <div className="section-heading">
        <div>
          <h2 id="analytics-title">Session analytics</h2>
          <p>
            {demo
              ? "Simulation · local timings, no API charges"
              : "Live · Jev requests through OpenRouter"}
          </p>
        </div>
      </div>
      <div className="metrics-strip">
        <div className="metric">
          <span>
            <Layers3 size={15} /> Requests
          </span>
          <strong>
            {entries.length.toLocaleString()}
            <small>requests</small>
          </strong>
          <p>
            {successful.length} completed<span className="metric-dot">/</span>
            {failures} failed{pending > 0 ? ` / ${pending} pending` : ""}
          </p>
        </div>
        <div className="metric">
          <span>
            <Clock3 size={15} /> Mean latency
          </span>
          <strong>
            {time(mean)}
            <small>ms</small>
          </strong>
          <p>
            {demo ? "Local simulation" : "Server round trip"} · excludes debounce
          </p>
        </div>
        <div className="metric">
          <span>
            <Activity size={15} /> P95 latency
          </span>
          <strong>
            {time(percentile(latencies, 0.95))}
            <small>ms</small>
          </strong>
          <p>Successful requests only</p>
        </div>
        <div className="metric cost-metric">
          <span>
            <span className="dollar-icon">$</span> Classifier spend
          </span>
          <strong>
            {money(total)}
            {unknownCost && <small>+</small>}
          </strong>
          <p>
            {demo
              ? "No charges in simulation"
              : unknownCost
                ? "Partial total · some costs unavailable"
                : estimated
                  ? "Includes estimated costs"
                  : "Reported by OpenRouter"}
          </p>
        </div>
      </div>
      <div className="analytics-charts">
        <div className="chart-panel">
          <div className="panel-heading">
            <h3>
              Response time <span>ms</span>
            </h3>
            <span>Last 30 successful requests</span>
          </div>
          <LatencyChart entries={entries} />
        </div>
        <div className="distribution-panel">
          <div className="panel-heading">
            <h3>Model distribution</h3>
            <span>{successful.length} routed</span>
          </div>
          <div
            className="distribution-track"
            aria-label="Model routing distribution"
          >
            {successful.length ? (
              counts
                .filter((c) => c.count)
                .map((c) => (
                  <div
                    key={c.model}
                    className={c.model}
                    style={{ width: `${(c.count / successful.length) * 100}%` }}
                  />
                ))
            ) : (
              <div className="distribution-empty" />
            )}
          </div>
          <div className="distribution-legend">
            {counts.map(({ model, count }) => {
              const { Icon, name } = modelMeta[model];
              return (
                <div key={model}>
                  <span className={`legend-model ${model}`}>
                    <Icon size={16} />
                    {name}
                  </span>
                  <strong>{count}</strong>
                  <span>
                    {successful.length
                      ? Math.round((count / successful.length) * 100)
                      : 0}
                    %
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="request-log">
        <div className="panel-heading">
          <h3>
            Requests <span className="count-badge">{entries.length}</span>
          </h3>
          <div className="log-actions">
            <button
              onClick={exportData}
              disabled={!entries.length}
              className="text-button"
            >
              <ArrowDownToLine size={14} />
              Export
            </button>
            <button
              onClick={onClear}
              disabled={!entries.length || pending > 0}
              className="text-button"
            >
              <Trash2 size={14} />
              Clear
            </button>
          </div>
        </div>
        {entries.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Route</th>
                  <th>Effort</th>
                  <th>Latency</th>
                  <th>Cost</th>
                  <th aria-label="Details" />
                </tr>
              </thead>
              <tbody>
                {[...entries]
                  .reverse()
                  .slice(0, 30)
                  .map((entry) => (
                    <RequestRow
                      key={entry.id}
                      entry={entry}
                      expanded={expanded === entry.id}
                      onToggle={() =>
                        setExpanded(expanded === entry.id ? null : entry.id)
                      }
                    />
                  ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="log-empty">
            <Layers3 size={20} />
            <div>
              <strong>No requests yet</strong>
              <span>
                Each classification is logged here with its route, latency,
                and cost.
              </span>
            </div>
          </div>
        )}
        {entries.length > 30 && (
          <p className="table-note">
            Showing the latest 30 requests. Export includes the full session.
          </p>
        )}
      </div>
    </section>
  );
}

function RequestRow({
  entry,
  expanded,
  onToggle,
}: {
  entry: RequestEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const r = entry.result;
  return (
    <>
      <tr className={entry.status === "error" ? "error-row" : ""}>
        <td className="task-cell">
          <span className={`request-dot ${entry.status}`} />
          <button onClick={onToggle} title={entry.prompt}>
            {entry.prompt}
          </button>
          <time>
            {new Date(entry.timestamp).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </time>
        </td>
        <td>
          {r ? (
            <span className={`route-tag ${r.model}`}>
              {modelMeta[r.model].name}
            </span>
          ) : (
            <span className="muted">
              {entry.status === "pending" ? "Pending" : "Failed"}
            </span>
          )}
        </td>
        <td>{r ? levelNames[r.difficulty] : "—"}</td>
        <td>{r ? `${time(r.latencyMs)} ms` : "—"}</td>
        <td>{r ? money(r.usage.costUsd) : "—"}</td>
        <td>
          <button
            className="icon-button details-toggle"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-label="Toggle request details"
          >
            <ChevronDown size={16} />
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="detail-row">
          <td colSpan={6}>
            <p>{entry.prompt}</p>
            {entry.error ? (
              <p className="error-text">
                {entry.error} Cost for this request is unknown.
              </p>
            ) : (
              <pre>
                {JSON.stringify(
                  { result: r, browserRoundTripMs: entry.roundTripMs },
                  null,
                  2,
                )}
              </pre>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export default function App() {
  const {
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
    resetSession,
    retry,
    reloadConfig,
  } = useClassifier();
  const [copied, setCopied] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => {
    if (!confirmReset) return;
    const id = window.setTimeout(() => setConfirmReset(false), 4000);
    return () => window.clearTimeout(id);
  }, [confirmReset]);
  const setupDialog = useRef<HTMLDialogElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const demo = mode === "demo";
  const busy = status === "classifying";
  const anyPending = entries.some((e) => e.status === "pending");
  const sessionEmpty = !entries.length && !prompt;
  const onReset = () => {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    if (resetSession()) {
      setConfirmReset(false);
      editor.current?.focus();
    }
  };
  const visibleEntries = entries.filter((e) => e.mode === mode);
  // Keep the last route on screen, dimmed, while the next one is pending, so
  // the readouts change in place as the task grows instead of blanking out.
  const [held, setHeld] = useState<Classification | null>(null);
  useEffect(() => {
    if (result) setHeld(result);
  }, [result]);
  useEffect(() => {
    if (!prompt.trim() || !live || status === "error") setHeld(null);
  }, [prompt, live, status]);
  useEffect(() => setHeld(null), [mode]);
  const shown = result ?? held;
  const stale = !result && !!held;
  const currentModel = shown
    ? config?.models.find((m) => m.key === shown.model)
    : undefined;
  const statusText = !live
    ? "Auto-classify is off"
    : status === "debouncing"
      ? "Waiting for typing to stop…"
      : busy
        ? "Classifying…"
        : status === "error"
          ? "Classification failed"
          : result
            ? `Classified in ${time(result.latencyMs)} ms`
            : "Idle";
  const copyRoute = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(
          {
            model: currentModel?.id ?? `openai/gpt-6-${result.model}`,
            reasoning: { effort: result.difficulty },
          },
          null,
          2,
        ),
      );
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="#" aria-label="Jev routing lab home">
            <span className="brand-symbol">
              <JevMark small />
            </span>
            <span>
              jev<span className="brand-period">.</span>
            </span>
          </a>
          <div className="brand-divider" />
          <span className="lab-name">Routing lab</span>
          <nav>
            <a href="#playground" className="nav-current">
              Playground
            </a>
            <a href="#analytics">Analytics</a>
          </nav>
          <button
            className={`connection-state ${config?.configured ? "connected" : ""}`}
            onClick={() => setupDialog.current?.showModal()}
          >
            <span />
            {config?.configured ? "API key configured" : "No API key"}
          </button>
          <button
            className="icon-button setup-button"
            aria-label="API setup and routing information"
            onClick={() => setupDialog.current?.showModal()}
          >
            <Settings2 size={19} />
          </button>
        </div>
      </header>
      <main>
        <section className="intro" id="playground">
          <div>
            <h1>Task routing</h1>
            <p>
              Jev scores how hard a task is. A fixed policy maps that score to a
              GPT-6 model and reasoning effort. Nothing is sent to GPT-6.
            </p>
          </div>
          <div className="intro-actions">
            <button
              className={`reset-button ${confirmReset ? "confirming" : ""}`}
              onClick={onReset}
              onBlur={() => setConfirmReset(false)}
              disabled={sessionEmpty || anyPending}
              title={
                anyPending
                  ? "Wait for the pending request to finish"
                  : "Clear the task, result, and request history for both modes"
              }
            >
              <RotateCcw size={14} />
              {confirmReset ? "Click again to reset" : "Reset session"}
            </button>
            <div className="mode-control" aria-label="Classification mode">
              <button
                aria-pressed={demo}
                className={demo ? "active" : ""}
                onClick={() => setMode("demo")}
              >
                Simulation
              </button>
              <button
                aria-pressed={!demo}
                className={!demo ? "active" : ""}
                onClick={() =>
                  config?.configured
                    ? setMode("live")
                    : setupDialog.current?.showModal()
                }
              >
                <span className="live-dot" />
                Live API
              </button>
            </div>
          </div>
        </section>
        {(configError || (demo && config)) && (
          <div className={`mode-notice ${configError ? "notice-error" : ""}`}>
            <CircleHelp size={15} />
            <span>
              {configError ??
                "Simulation uses local heuristics instead of Jev, so the scores and probabilities are approximate. Add an OpenRouter key to use the real classifier."}
            </span>
            <button
              onClick={() =>
                configError ? reloadConfig() : setupDialog.current?.showModal()
              }
            >
              {configError ? "Retry" : "Setup"}
              <ArrowRight size={14} />
            </button>
          </div>
        )}
        <section className="workspace" aria-label="Task routing playground">
          <div className="editor-panel">
            <div className="editor-heading">
              <label htmlFor="task-input">Task</label>
              <label className="auto-label">
                <span>Auto-classify</span>
                <input
                  type="checkbox"
                  checked={live}
                  onChange={(e) => setLive(e.target.checked)}
                />
                <span className="switch" />
              </label>
            </div>
            <div className="input-area">
              <textarea
                id="task-input"
                ref={editor}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                maxLength={12000}
                spellCheck={false}
                placeholder={
                  "Type or paste a task. Classification runs when you stop typing."
                }
                aria-describedby="input-help"
              />
              <div className="input-meta">
                <span>
                  {prompt.length.toLocaleString()}
                  <span className="muted"> / 12,000 characters</span>
                </span>
                {prompt && (
                  <button
                    className="text-button"
                    onClick={() => {
                      setPrompt("");
                      editor.current?.focus();
                    }}
                  >
                    Clear
                    <X size={13} />
                  </button>
                )}
              </div>
            </div>
            <div className="examples">
              <span>Examples</span>
              <div>
                {examples.map((example) => (
                  <button
                    key={example.name}
                    onClick={() => {
                      setPrompt(example.prompt);
                      editor.current?.focus();
                    }}
                  >
                    <example.icon size={14} />
                    {example.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="editor-footer" id="input-help">
              <span
                className={`status-indicator ${busy ? "working" : ""} ${status === "error" ? "failed" : ""}`}
              />
              <span role="status">{statusText}</span>
              <span className="debounce-badge">
                <Clock3 size={12} />
                {config?.debounceMs ?? 300}ms debounce
              </span>
            </div>
            {(error || configError) && (
              <div className="request-error" role="alert">
                <span>{error ?? configError}</span>
                <button onClick={configError ? reloadConfig : retry}>
                  <RotateCcw size={14} />
                  Retry
                </button>
              </div>
            )}
          </div>
          <div className={`route-panel ${stale ? "is-stale" : ""}`}>
            <div className="route-heading">
              <h2>Route</h2>
              <span className="family-badge">OpenAI GPT-6</span>
            </div>
            <RoutingMap result={shown} busy={busy} />
            <div className="route-summary">
              <div className="effort-heading">
                <span>Reasoning effort</span>
                {shown && (
                  <span className="confidence">
                    Confidence{" "}
                    <strong>{Math.round(shown.confidence * 100)}%</strong>
                  </span>
                )}
              </div>
              <div className="effort-scale">
                {levels.map((level) => (
                  <div
                    key={level}
                    className={
                      shown?.difficulty === level
                        ? `effort-selected ${shown.model}`
                        : ""
                    }
                  >
                    <span />
                    {levelNames[level]}
                  </div>
                ))}
              </div>
              <div className="route-outcome">
                <span>
                  {shown ? (
                    <>
                      <strong>{modelMeta[shown.model].name}</strong> with{" "}
                      <strong>
                        {levelNames[shown.difficulty].toLowerCase()}
                      </strong>{" "}
                      reasoning
                    </>
                  ) : (
                    "No task classified yet"
                  )}
                </span>
                <button
                  className="text-button"
                  onClick={copyRoute}
                  disabled={!result}
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? "Copied" : "Copy route"}
                </button>
              </div>
            </div>
          </div>
        </section>
        <section
          className={`decision-details ${stale ? "is-stale" : ""}`}
          aria-label="Decision details"
        >
          <div className="complexity-readout">
            <div>
              <Cpu size={17} />
              <span>Task complexity</span>
              <strong>
                {shown ? Math.round(shown.complexity) : "—"}
                <small>/ 100</small>
              </strong>
            </div>
            <div className="complexity-track">
              {Array.from({ length: 30 }, (_, i) => (
                <span
                  key={i}
                  className={
                    shown && i < (shown.complexity / 100) * 30 ? "filled" : ""
                  }
                  style={{ "--segment": i } as CSSProperties}
                />
              ))}
            </div>
          </div>
          <div className="probability-readout">
            <div>
              <span>Difficulty probabilities</span>
              <span className="small-note">
                {demo ? "Simulated" : "From Jev"}
              </span>
            </div>
            <div className="probability-bars">
              {levels.map((level) => {
                const probability =
                  shown?.probabilities.find((p) => p.level === level)
                    ?.probability ?? 0;
                return (
                  <div
                    key={level}
                    title={`${levelNames[level]}: ${Math.round(probability * 100)}%`}
                  >
                    <span>{levelNames[level]}</span>
                    <div>
                      <i style={{ width: `${probability * 100}%` }} />
                    </div>
                    <strong>
                      {shown ? `${Math.round(probability * 100)}%` : "—"}
                    </strong>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="price-readout">
            <span>
              <Tag size={16} />
              Model pricing
            </span>
            <strong>
              {currentModel?.inputPerMillion != null
                ? `$${currentModel.inputPerMillion.toFixed(2)}`
                : "—"}
              <small> / 1M input tokens</small>
            </strong>
            <p>
              {currentModel?.outputPerMillion != null
                ? `$${currentModel.outputPerMillion.toFixed(2)} / 1M output tokens`
                : "Shown after a task is classified"}
            </p>
            <span className="small-note">
              OpenRouter list prices, for reference
            </span>
          </div>
        </section>
        <Analytics
          entries={visibleEntries}
          demo={demo}
          onClear={clearHistory}
        />
        <footer className="footer">
          <span>
            <JevMark small />
            Jev routing lab
          </span>
          <span>
            Powered by{" "}
            <a
              href="https://openrouter.ai/typesafe/jev-1.13"
              target="_blank"
              rel="noreferrer"
            >
              Jev
            </a>{" "}
            through{" "}
            <a href="https://openrouter.ai" target="_blank" rel="noreferrer">
              OpenRouter
            </a>
            <span className="footer-separator" />
            History is kept in this tab only
          </span>
        </footer>
      </main>
      <dialog
        ref={setupDialog}
        className="setup-dialog"
        aria-labelledby="setup-title"
      >
        <div className="dialog-heading">
          <span className="dialog-icon">
            <Settings2 size={22} />
          </span>
          <button
            className="icon-button"
            onClick={() => setupDialog.current?.close()}
            aria-label="Close setup"
          >
            <X size={21} />
          </button>
        </div>
        <h2 id="setup-title">Live API setup</h2>
        <p>
          Live mode sends each task to Jev through OpenRouter. The key is read
          by the local server and never sent to the browser.
        </p>
        <ol className="setup-steps">
          <li>
            <span>1</span>
            <div>
              <strong>Add your OpenRouter key</strong>
              <p>
                Edit the <code>.env</code> file in the project root.
              </p>
              <pre>OPENROUTER_API_KEY=your_key_here</pre>
              <a
                href="https://openrouter.ai/keys"
                target="_blank"
                rel="noreferrer"
              >
                Get an OpenRouter key <ExternalLink size={13} />
              </a>
            </div>
          </li>
          <li>
            <span>2</span>
            <div>
              <strong>Restart the app</strong>
              <p>
                Stop the development server, then run <code>npm run dev</code>.
              </p>
            </div>
          </li>
          <li>
            <span>3</span>
            <div>
              <strong>Switch to Live API</strong>
              <p>
                A task is sent {config?.debounceMs ?? 300} ms after you stop
                typing. Only Jev is called; Luna, Sol, and Astra are
                recommendations, not requests.
              </p>
            </div>
          </li>
        </ol>
        <details className="policy-details">
          <summary>How the routing policy works</summary>
          <p>
            Jev scores complexity across five levels. Low and medium → Luna,
            high → Sol, x-high and max → Astra. The selected difficulty becomes
            the reasoning effort.
          </p>
          <p>
            Probabilities describe Jev’s classification confidence, not
            guaranteed task quality. Simulation uses local heuristics with
            synthetic probabilities.
          </p>
          <p>
            Spend is the Jev classification charge. Model prices are reference
            per-token rates; they are not a quote for running your task.
          </p>
        </details>
        <button
          className="primary-button"
          onClick={() => {
            reloadConfig();
            setupDialog.current?.close();
          }}
        >
          Check connection
          <ArrowRight size={16} />
        </button>
      </dialog>
    </>
  );
}
