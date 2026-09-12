import { sendHumanBurst, getSocket } from './socket';
import { LaravelClient } from './LaravelClient';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getRandomDelay = (): number => {
  const min = 60;
  const max = 120;
  return (Math.floor(Math.random() * (max - min + 1)) + min) * 1000;
};

const isWithinBusinessHours = (): boolean => {
  const hour = new Date().getHours();
  return hour >= 8 && hour < 18;
};

// Quita cualquier parámetro dentro de los paréntesis:
export const startScheduledMessageWorker = async () => {
  console.log('[Worker] Programador activo (08:00 a 18:00, Jitter 60-120s)...');

  while (true) {
    try {
      if (!isWithinBusinessHours()) {
        await sleep(15 * 60 * 1000);
        continue;
      }

      const sock = getSocket();
      if (sock) {
        const response = await LaravelClient.getPendingScheduled();
        const msg = response?.data;

        if (msg) {
          console.log(`[Worker] Enviando mensaje programado a ${msg.phone}...`);
          await sendHumanBurst(`${msg.phone}@s.whatsapp.net`, msg.payload);
          await LaravelClient.markScheduledSent(msg.id);
        }
      }
    } catch (err: any) {
      console.error('[Worker Error]:', err.response?.data || err.message);
    }

    const delay = getRandomDelay();
    await sleep(delay);
  }
};