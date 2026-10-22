declare module "mammoth" {
  export interface RawTextResult {
    value: string;
    messages: unknown[];
  }

  export function extractRawText(options: {
    buffer?: Buffer;
    path?: string;
  }): Promise<RawTextResult>;
}
