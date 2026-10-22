import { type z } from "zod";

export class AiInvalidOutputError extends Error {
  public readonly issues: z.ZodIssue[];

  constructor(message: string, issues: z.ZodIssue[] = []) {
    super(message);
    this.name = "AiInvalidOutputError";
    this.issues = issues;
  }
}

export class AiUnavailableError extends Error {
  public readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "AiUnavailableError";
    this.cause = cause;
  }
}

export interface GenerateJsonOptions<T> {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  timeoutMs?: number;
  preferredProvider?: "gemini" | "groq";
}

export interface GenerateJsonResult<T> {
  data: T;
  provider: "gemini" | "groq";
  model: string;
  latencyMs: number;
}
