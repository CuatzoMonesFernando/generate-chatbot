import axios from 'axios';
import { AUTOS_SYSTEM_PROMPT } from './Prompts'

export class DeepSeekService {
  private static getApiKey(): string {
    return process.env.DEEPSEEK_API_KEY || '';
  }

  private static getApiUrl(): string {
    const base = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
    return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
  }

  static async generateReply(
    history: { role: 'user' | 'assistant'; content: string }[],
    systemPrompt: string = AUTOS_SYSTEM_PROMPT,
    temperature: number = 0.6,
    maxTokens: number = 400
  ): Promise<string> {
    try {
      const response = await axios.post(
        this.getApiUrl(),
        {
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: systemPrompt },
            ...history
          ],
          temperature: temperature,
          max_tokens: maxTokens
        },
        {
          headers: {
            'Authorization': `Bearer ${this.getApiKey()}`,
            'Content-Type': 'application/json'
          },
          timeout: 25000
        }
      );

      return response.data.choices[0].message.content.trim();
    } catch (err: any) {
      console.error('Error invocando DeepSeek API:', err.response?.data || err.message);
      return '¡Hola! Recibí tu mensaje. Dame un momento por favor para revisar los detalles técnicos y responderte adecuadamente.';
    }
  }
}