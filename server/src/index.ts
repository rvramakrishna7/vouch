import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";

const app = express();

// CORS: only origins listed in CLIENT_ORIGIN (comma-separated) are allowed.
const allowedOrigins = (process.env.CLIENT_ORIGIN ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Requests with no Origin header (curl, server-to-server) are not CORS requests.
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(null, false);
    },
  }),
);

app.use(express.json({ limit: "4mb" }));

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", service: "vouch-server", time: new Date().toISOString() });
});

// Unknown routes
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "not_found" });
});

// Final JSON error handler. No stack traces in production.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const e = err as { status?: number; statusCode?: number; message?: string; stack?: string };
  const status = e.status ?? e.statusCode ?? 500;
  const isProd = process.env.NODE_ENV === "production";
  const body: Record<string, unknown> = {
    error: status >= 500 ? "internal_error" : (e.message ?? "error"),
  };
  if (!isProd) {
    body.message = e.message;
    body.stack = e.stack;
  }
  if (status >= 500) console.error(isProd ? e.message : err);
  res.status(status).json(body);
});

export default app;
