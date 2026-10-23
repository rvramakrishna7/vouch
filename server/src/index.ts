import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { timingMiddleware } from "./middleware/timing.js";
import authRouter from "./routes/auth.js";
import contentsRouter from "./routes/contents.js";
import factsRouter from "./routes/facts.js";
import rulesRouter from "./routes/rules.js";
import termsRouter from "./routes/terms.js";
import { aiRouter } from "./routes/ai.js";
import findingsRouter from "./routes/findings.js";
import auditRouter from "./routes/audit.js";

const app = express();

// Server-Timing instrumentation
app.use(timingMiddleware);

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
    exposedHeaders: ["Server-Timing"],
  }),
);

app.use(express.json({ limit: "4mb" }));

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", service: "vouch-server", time: new Date().toISOString() });
});

// Routes
app.use("/api/auth", authRouter);
app.use("/api/contents", contentsRouter);
app.use("/api/rules", rulesRouter);
app.use("/api/facts", factsRouter);
app.use("/api/terms", termsRouter);
app.use("/api/ai", aiRouter);
app.use("/api/findings", findingsRouter);
app.use("/api/audit", auditRouter);

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
