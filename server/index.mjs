import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createApp } from "./app.mjs";
import { DEFAULT_MODEL } from "./classifier.mjs";

const projectDir = fileURLToPath(new URL("../", import.meta.url));
dotenv.config({ path: resolve(projectDir, ".env"), quiet: true });
const port = Number(process.env.PORT || 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("PORT must be between 1 and 65535.");
const host = process.env.HOST || "127.0.0.1";
const app = createApp({
  apiKey: process.env.OPENROUTER_API_KEY || "",
  model: process.env.JEV_MODEL?.trim() || DEFAULT_MODEL,
  staticDir: resolve(projectDir, "dist"),
});
app.listen(port, host, () =>
  console.log(`Jev Routing Lab server: http://${host}:${port}`),
);
