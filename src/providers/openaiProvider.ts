import type { LLMProvider } from './types.js';

export class OpenAIProvider implements LLMProvider {
  private apiKey: string;
  private model: string;

  constructor(apiKey?: string, model?: string) {
    this.apiKey = apiKey || process.env.OPENAI_API_KEY || '';
    if (!this.apiKey) throw new Error('OPENAI_API_KEY is not configured');
    this.model = model || process.env.OPENAI_MODEL || 'gpt-4o-mini';
  }

  async generateJSON(prompt: string, _schema?: any) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: 'You are a JSON extraction assistant.' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 2000,
      }),
    });

    const json = await res.json();
    return json?.choices?.[0]?.message?.content ?? JSON.stringify(json);
  }
}

export function createOpenAIProvider(apiKey?: string, model?: string) {
  return new OpenAIProvider(apiKey, model);
}
