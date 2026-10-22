import { AsyncLocalStorage } from "node:async_hooks";
import type { Request, Response, NextFunction } from "express";

export interface RequestTimingStore {
  startTime: number;
  dbTime: number;
  aiTime: number;
}

export const timingStorage = new AsyncLocalStorage<RequestTimingStore>();

export function timingMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const store: RequestTimingStore = {
    startTime: performance.now(),
    dbTime: 0,
    aiTime: 0,
  };

  timingStorage.run(store, () => {
    // Intercept response finish/end to append Server-Timing header
    const originalEnd = res.end.bind(res);

    res.end = function (...args: any[]) {
      if (!res.headersSent) {
        const totalDuration = performance.now() - store.startTime;
        const dbDuration = store.dbTime;
        const parts = [
          ...(store.aiTime > 0 ? [`ai;dur=${store.aiTime.toFixed(1)}`] : []),
          `db;dur=${dbDuration.toFixed(1)}`,
          `total;dur=${totalDuration.toFixed(1)}`,
        ];
        res.setHeader("Server-Timing", parts.join(", "));
      }
      return (originalEnd as any)(...args);
    };

    next();
  });
}
