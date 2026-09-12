import express, { Request, Response } from 'express';
import { initWhatsApp, latestQrString, sendHumanBurst } from './socket';
import QRCode from 'qrcode';
import { startScheduledMessageWorker } from './worker';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 54321;

app.post('/api/whatsapp/send', async (req: Request, res: Response) => {
  const { jid, text } = req.body;
  if (!jid || !text) {
    return res.status(400).json({ ok: false, error: 'Faltan parámetros jid o text' });
  }

  sendHumanBurst(jid, text).catch((err: any) =>
    console.error(`Error enviando mensaje manual a ${jid}:`, err.message)
  );

  res.json({ ok: true });
});

app.get('/qr', async (_req: Request, res: Response) => {
  if (!latestQrString) {
    return res.send(`
      <div style="font-family: sans-serif; text-align: center; margin-top: 50px;">
        <h2>No hay código QR activo</h2>
        <p>El dispositivo ya está conectado o el socket aún está inicializando.</p>
      </div>
    `);
  }

  try {
    const qrImage = await QRCode.toDataURL(latestQrString, { scale: 8, margin: 2 });
    res.send(`
      <div style="font-family: sans-serif; text-align: center; margin-top: 50px;">
        <h2>Escanea con tu WhatsApp</h2>
        <img src="${qrImage}" style="border: 2px solid #ccc; border-radius: 8px;" />
        <p>WhatsApp > Dispositivos vinculados > Vincular un dispositivo</p>
      </div>
    `);
  } catch (err: any) {
    res.status(500).send('Error generando QR');
  }
});

app.listen(PORT, () => {
  console.log(`whatsapp-service iniciado en puerto ${PORT}`);
  initWhatsApp();
  startScheduledMessageWorker();
});