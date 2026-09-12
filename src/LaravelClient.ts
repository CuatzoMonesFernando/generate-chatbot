import axios from 'axios';
import { AUTOS_SYSTEM_PROMPT } from './Prompts';

const baseURL = (process.env.LARAVEL_API_URL || 'https://verticepatrimonial.com.mx/api/v1').replace(/\/+$/, '');
const SECRET = process.env.INTERNAL_API_SECRET_TOKEN || '';
  

 const api = axios.create({
  baseURL,
  headers: {
    'X-Internal-Secret': SECRET,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  },
  timeout: 10000,
});

export interface ChatContext {
  status: string;
  lead_id: string; // UUID string
  system_prompt: string;
  temperature: number;
  max_tokens: number;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  is_bot_active?: boolean;
}

export interface ScheduledMessageData {
  id: string; // UUID
  phone: string;
  payload: string;
  type: string;
}

export class LaravelClient {

   static async checkGlobalBotStatus(): Promise<boolean> {
    try {
      const res = await api.post('/bot/status', {});
      return res.data.bot_enabled === true;
    } catch {
      return false;
    }
  }

  static async getContext(phone: string): Promise<ChatContext> {
    try {
      const response = await api.post('/chat/init-context', { phone });
      return response.data;
    } catch (error: any) {
      if (error.response) {
        console.error("Status:", error.response.status);
        console.error("URL llamada:", error.config.baseURL + error.config.url);
      }
      return {
        status: 'paused',
        lead_id: "0",
        system_prompt: AUTOS_SYSTEM_PROMPT,
        temperature: 0.7,
        max_tokens: 500,
        history: []
      };
    }
  }

  static async logMessage(phone: string, userMsg: string, botMsg: string): Promise<void> {
    try {
      await api.post('/chat/log', {
        phone,
        user_message: userMsg,
        bot_message: botMsg
      });
    } catch (error: any) {
      console.error('Error al enviar log a Laravel:', error.message);
    }
  }

   static async logBackgroundText(phone: string, role: 'user' | 'assistant', content: string): Promise<void> {
    try {
      await api.post('/chat/log-message', { phone, role, content });
    } catch (err: any) {
      console.error('Error guardando texto en segundo plano:', err.message);
    }
  }

  static async getPendingScheduled(): Promise<{ status: string; data: ScheduledMessageData | null }> {
    try {
      const res = await api.post('/scheduled-messages/pending', {});
      return res.data;
    } catch (err: any) {
      console.error('Error al consultar mensajes programados:', err.response?.data || err.message);
      return { status: 'error', data: null };
    }
  }

  static async markScheduledSent(scheduledMessageId: string): Promise<void> {
    try {
      await api.post('/scheduled-messages/mark-sent', {
        scheduled_message_id: scheduledMessageId,
      });
    } catch (err: any) {
      console.error('Error marcando mensaje programado como enviado:', err.response?.data || err.message);
    }
  }
}