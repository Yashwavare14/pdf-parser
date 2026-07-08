import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { LLMProvider } from './types.js';

class GeminiProvider implements LLMProvider {
  private ai: any;
  private model: string;

  constructor(apiKey?: string, model?: string) {
    const key = apiKey || process.env.GEMINI_API_KEY;
    if (!key) throw new Error('GEMINI_API_KEY is not configured');
    this.ai = new GoogleGenAI({ apiKey: key });
    this.model = model || process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  }

  async generateJSON(prompt: string, schema?: any) {
    const contents = [prompt];
    const config: any = {
      responseMimeType: schema ? 'application/json' : undefined,
      responseJsonSchema: schema || undefined,
      maxOutputTokens: 200000,
      temperature: 0.1,
    };

    const stream = await this.ai.models.generateContentStream({
      model: this.model,
      contents,
      config,
    });

    let fullText = '';
    for await (const chunk of stream) {
      if (chunk.text) fullText += chunk.text;
    }

    return fullText;
  }

  async generateFromImage(prompt: string, imageBase64: string, mimeType = 'image/png') {
    const tmpDir = os.tmpdir();
    const tmpName = `gemini-image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
    const tmpPath = path.join(tmpDir, tmpName);

    try {
      fs.writeFileSync(tmpPath, Buffer.from(imageBase64, 'base64'));
      const uploaded = await this.ai.files.upload({ file: tmpPath, config: { mimeType } });

      const fileContent = uploaded && uploaded.uri ? { fileData: { fileUri: uploaded.uri, mimeType } } : null;
      const requestContents = fileContent ? [fileContent, prompt] : [prompt];

      const stream = await this.ai.models.generateContentStream({
        model: this.model,
        contents: requestContents,
        config: {
          responseMimeType: 'application/json',
          maxOutputTokens: 200000,
          temperature: 0.1,
        },
      });

      let fullText = '';
      for await (const chunk of stream) {
        if (chunk.text) fullText += chunk.text;
      }

      return fullText;
    } finally {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        // ignore cleanup failures
      }
    }
  }
}

export function createGeminiProvider(apiKey?: string, model?: string) {
  return new GeminiProvider(apiKey, model);
}

export default GeminiProvider;
