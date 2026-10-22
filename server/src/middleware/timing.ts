import { AsyncLocalStorage } from "node:async_hooks";
import type { Request, Response, NextFunction } from "express";

export interface RequestTimingStore {
  startTime: number;
  dbTime: number;
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
  };

  timingStorage.run(store, () => {
    // Intercept response finish/end to append Server-Timing header
    const originalEnd = res.end.bind(res);

    res.end = function (...args: any[]) {
      if (!res.headersSent) {
        const totalDuration = performance.now() - store.startTime;
        const dbDuration = store.dbTime;
        res.setHeader(
          "Server-Timing",
          `db;dur=${dbDuration.toFixed(1)}, total;dur=${totalDuration.toFixed(1)}`,
        );
      }
      return (originalEnd as any)(...args);
    };

    next();
  });
}
