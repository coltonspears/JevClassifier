// Vercel entry point. Vercel runs this as a serverless function instead of
// starting server/index.mjs, so there is no HOST or PORT to configure.
// vercel.json rewrites every /api/* request here; Express still sees the
// original path and routes it as usual. The built frontend in dist/ is served
// by Vercel directly.
import { createApp } from "../server/app.mjs";

export default createApp({
  apiKey: process.env.OPENROUTER_API_KEY || "",
  model: process.env.JEV_MODEL?.trim() || undefined,
});
