import { AsyncLocalStorage } from "node:async_hooks";
import type { Request, Response, NextFunction } from "express";

export interface RequestTimingStore {
  startTime: number;
  authTime: number;
  dbTime: number;
  aiTime: number;
  embedTime: number;
  aiAttempts?: string[];
}

export const timingStorage = new AsyncLocalStorage<RequestTimingStore>();

export function timingMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const store: RequestTimingStore = {
    startTime: performance.now(),
    authTime: 0,
    dbTime: 0,
    aiTime: 0,
    embedTime: 0,
    aiAttempts: [],
  };

  timingStorage.run(store, () => {
    // Intercept response finish/end to append Server-Timing header
    const originalEnd = res.end.bind(res);

    res.end = function (...args: any[]) {
      if (!res.headersSent) {
        const totalDuration = performance.now() - store.startTime;
        const dbDuration = store.dbTime;
        const url = req.originalUrl || req.url || "";
        const isDesignatedBreakdown =
          req.method === "POST" &&
          (url.includes("/api/auth/demo") ||
            url.includes("/api/guidelines/draft") ||
            /\/api\/contents\/[^/]+\/reviews/.test(url));

        let parts: string[];
        if (isDesignatedBreakdown) {
          // Requirement 2 & 4: Explicit breakdown (auth, db, ai, [attempts], embed, total)
          parts = [
            `auth;dur=${store.authTime.toFixed(1)}`,
            `db;dur=${dbDuration.toFixed(1)}`,
            `ai;dur=${store.aiTime.toFixed(1)}`,
            ...(store.aiAttempts && store.aiAttempts.length > 0 ? store.aiAttempts : []),
            `embed;dur=${store.embedTime.toFixed(1)}`,
            `total;dur=${totalDuration.toFixed(1)}`,
          ];
        } else {
          parts = [
            ...(store.authTime > 0 ? [`auth;dur=${store.authTime.toFixed(1)}`] : []),
            `db;dur=${dbDuration.toFixed(1)}`,
            `ai;dur=${store.aiTime.toFixed(1)}`,
            ...(store.aiAttempts && store.aiAttempts.length > 0 ? store.aiAttempts : []),
            ...(store.embedTime > 0 ? [`embed;dur=${store.embedTime.toFixed(1)}`] : []),
            `total;dur=${totalDuration.toFixed(1)}`,
          ];
        }
        res.setHeader("Server-Timing", parts.join(", "));
      }
      return (originalEnd as any)(...args);
    };

    next();
  });
}
