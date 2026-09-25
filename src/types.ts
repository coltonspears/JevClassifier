export type ModelKey = "luna" | "sol" | "astra";
export type Difficulty = "low" | "medium" | "high" | "xhigh" | "max";
export type Mode = "live" | "demo";
export interface ModelInfo {
  id: string;
  key: ModelKey;
  name: string;
  description: string;
  inputPerMillion: number | null;
  outputPerMillion: number | null;
  priceSource: string;
}
export interface AppConfig {
  configured: boolean;
  classifierModel: string;
  debounceMs: number;
  models: ModelInfo[];
  efforts?: Difficulty[];
}
export interface Classification {
  id: string;
  timestamp: string;
  mode: Mode;
  prompt: string;
  complexity: number;
  difficulty: Difficulty;
  model: ModelKey;
  confidence: number;
  probabilities: { level: Difficulty; probability: number }[];
  signals: { name: string; value: number }[];
  latencyMs: number;
  usage: {
    inputTokens: number;
    outputTokens: number;
    costUsd: number | null;
    costSource: "reported" | "estimated" | "unavailable" | "simulation";
  };
  classifierModel: string;
}
export interface RequestEntry {
  id: string;
  timestamp: string;
  mode: Mode;
  prompt: string;
  status: "pending" | "success" | "error";
  result?: Classification;
  error?: string;
  roundTripMs?: number;
}
