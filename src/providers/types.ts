export interface LLMProvider {
  generateJSON: (prompt: string, schema?: any) => Promise<string>;
  generateFromImage?: (prompt: string, imageBase64: string, mimeType: string) => Promise<string>;
}
