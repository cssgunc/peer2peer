// Server-only URL Next.js uses to reach FastAPI. Override with BACKEND_URL in .env.local or the shell.
export const BACKEND_URL = (
  process.env.BACKEND_URL ?? "http://localhost:8000"
).replace(/\/$/, "");
