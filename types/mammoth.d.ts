declare module "mammoth/mammoth.browser" {
  export function convertToHtml(options: {
    arrayBuffer: ArrayBuffer;
  }): Promise<{
    value: string;
    messages: Array<{ type: string; message: string }>;
  }>;

  export function extractRawText(options: {
    arrayBuffer: ArrayBuffer;
  }): Promise<{ value: string; messages: Array<{ type: string; message: string }> }>;
}