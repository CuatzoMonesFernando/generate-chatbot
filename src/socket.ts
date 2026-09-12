import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WASocket,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import pino from "pino";
import qrcode from "qrcode-terminal";
import { LaravelClient } from "./LaravelClient";
import { DeepSeekService } from "./DeepSeekService";
import path from "path";
import axios from "axios";
import { Buffer } from "node:buffer";
import FormData = require("form-data");

let sock: WASocket | null = null;
let isConnecting = false;
let reconnectTimer: NodeJS.Timeout | null = null;
let reconnectAttempts = 0;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export let latestQrString: string | null = null;

export const getSocket = (): WASocket => {
  if (!sock) throw new Error("Socket no inicializado");
  return sock;
};

export const sanitizePhone = (jid: string): string => {
  let phone = jid.replace(/@.+$/, "");
  if (phone.startsWith("521") && phone.length === 13) {
    phone = "52" + phone.substring(3);
  }
  return phone;
};

export const sendHumanBurst = async (jid: string, text: string) => {
  if (!sock) return;

  const fragments = text
    .split(/\|{2,3}/)
    .map((f) => f.trim())
    .filter(Boolean);

  for (const fragment of fragments) {
    try {
      await sock.sendPresenceUpdate("composing", jid);
      const typingDuration = Math.min(Math.max(fragment.length * 35, 1200), 4000);
      await sleep(typingDuration);

      await sock.sendPresenceUpdate("paused", jid);
      await sock.sendMessage(jid, { text: fragment });
      await sleep(800);
    } catch (err: any) {
      console.error(`Error enviando fragmento a ${jid}:`, err.message);
    }
  }
};

interface UserQueue {
  timer: NodeJS.Timeout | null;
  messages: string[];
  lastMsgKey: any;
}
const userQueues = new Map<string, UserQueue>();

let isBotGloballyActive = true;
setInterval(async () => {
  isBotGloballyActive = await LaravelClient.checkGlobalBotStatus();
}, 20000);

async function processBufferedMessages(jid: string, cleanPhone: string) {
  const queue = userQueues.get(jid);
  if (!queue || queue.messages.length === 0) return;

  const fullText = queue.messages.join("\n");
  const lastKey = queue.lastMsgKey;
  userQueues.delete(jid);

  try {
    if (lastKey) await sock?.readMessages([lastKey]);
    await sleep(800);

    const context = await LaravelClient.getContext(cleanPhone);

    if (!isBotGloballyActive || context.is_bot_active === false) {
      await LaravelClient.logBackgroundText(cleanPhone, "user", fullText);
      return;
    }

    await sock?.sendPresenceUpdate("composing", jid);
    const history = [
      ...context.history,
      { role: "user" as const, content: fullText },
    ];
    const botReply = await DeepSeekService.generateReply(
      history,
      context.system_prompt,
      context.temperature,
      context.max_tokens,
    );

    await sendHumanBurst(jid, botReply);
    await LaravelClient.logMessage(cleanPhone, fullText, botReply);
  } catch (err: any) {
    await sock?.sendPresenceUpdate("paused", jid).catch(() => {});
    console.error(`Error en lote para ${cleanPhone}:`, err.message);
  }
}

export const initWhatsApp = async () => {
  if (isConnecting) return;
  isConnecting = true;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  // Destrucción limpia y segura de la instancia anterior
  if (sock) {
    try {
      sock.ev.removeAllListeners("connection.update");
      sock.ev.removeAllListeners("creds.update");
      sock.ev.removeAllListeners("messages.upsert");
      sock.end(undefined);
    } catch (_) {}
    sock = null;
  }

  const authDir = path.resolve("./baileys_auth");
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: "silent" }),
    // Firma de navegador fija y estándar
    browser: ["Ubuntu", "Chrome", "125.0.6422.141"],
    syncFullHistory: false,
    markOnlineOnConnect: true,
    connectTimeoutMs: 60_000,
    defaultQueryTimeoutMs: 60_000,
    keepAliveIntervalMs: 25_000,
  });

  isConnecting = false;

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      latestQrString = qr;
      console.log("\n--- ESCANEA ESTE CÓDIGO QR EN TU WHATSAPP ---");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "close") {
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      console.warn(`[Socket] Conexión cerrada. Código de desconexión: ${statusCode}`);

      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      try {
        sock?.ev.removeAllListeners("connection.update");
        sock?.ev.removeAllListeners("creds.update");
        sock?.ev.removeAllListeners("messages.upsert");
        sock?.end(undefined);
      } catch (_) {}
      sock = null;

      if (shouldReconnect) {
        reconnectAttempts++;
        // Backoff exponencial para evitar saturar el servidor si hay caída de red
        const delay = Math.min(reconnectAttempts * 3000, 30000);
        console.log(`[Socket] Reconectando sesión en ${delay / 1000}s (Intento ${reconnectAttempts})...`);
        
        reconnectTimer = setTimeout(() => {
          isConnecting = false;
          initWhatsApp();
        }, delay);
      } else {
        // En lugar de borrar archivos automáticamente, solo se alerta
        console.error(
          "[Socket] ⚠️ Sesión cerrada por WhatsApp (Logged Out). Las credenciales locales se conservaron. " +
          "Si desvinculaste manualmente el dispositivo desde tu teléfono, borra el volumen docker o la carpeta baileys_auth para regenerar el QR."
        );
        latestQrString = null;
      }
    } else if (connection === "open") {
      console.log("[Socket] ✅ Conexión con WhatsApp lista y activa permanentemente.");
      reconnectAttempts = 0;
      latestQrString = null;
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      if (!msg.message) continue;

      const jid = msg.key.remoteJid;
      if (!jid || jid.endsWith("@g.us") || jid === "status@broadcast") continue;

      const cleanPhone = sanitizePhone(jid);
      const isFromMe = Boolean(msg.key.fromMe);
      const role = isFromMe ? "assistant" : "user";
      const msgType = Object.keys(msg.message)[0];

      if (["imageMessage", "audioMessage", "documentMessage"].includes(msgType)) {
        downloadMediaMessage(msg, "buffer", {})
          .then(async (buffer) => {
            const mediaInfo = (msg.message as any)[msgType];
            const mimeType: string = mediaInfo?.mimetype || "application/octet-stream";

            let ext = "bin";
            if (mimeType.includes("ogg") || mimeType.includes("opus")) ext = "ogg";
            else if (mimeType.includes("jpeg") || mimeType.includes("jpg")) ext = "jpg";
            else if (mimeType.includes("png")) ext = "png";
            else if (mimeType.includes("pdf")) ext = "pdf";
            else if (mimeType.includes("mp4")) ext = "mp4";

            const form = new FormData();
            form.append("phone", cleanPhone);
            form.append("role", role);
            form.append("type", msgType.replace("Message", ""));
            form.append("mime_type", mimeType);
            form.append("caption", mediaInfo?.caption || "");
            form.append("file", buffer as Buffer, {
              filename: `media_${Date.now()}.${ext}`,
              contentType: mimeType,
            });

            await axios.post(
              `${process.env.LARAVEL_API_URL}/chat/media-log`,
              form,
              {
                headers: {
                  ...form.getHeaders(),
                  "X-Internal-Secret": process.env.INTERNAL_API_SECRET_TOKEN || "",
                },
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
                timeout: 30000,
              },
            );
          })
          .catch((err: any) =>
            console.error("Error al procesar archivo multimedia:", err.message),
          );

        continue;
      }

      const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
      if (!text.trim()) continue;

      if (isFromMe) {
        LaravelClient.logBackgroundText(cleanPhone, "assistant", text.trim());
        continue;
      }

      if (!isBotGloballyActive) {
        LaravelClient.logBackgroundText(cleanPhone, "user", text.trim());
        continue;
      }

      let queue = userQueues.get(jid);
      if (!queue) {
        queue = { timer: null, messages: [], lastMsgKey: msg.key };
        userQueues.set(jid, queue);
      } else {
        if (queue.timer) clearTimeout(queue.timer);
        queue.lastMsgKey = msg.key;
      }

      queue.messages.push(text.trim());
      queue.timer = setTimeout(() => {
        processBufferedMessages(jid, cleanPhone);
      }, 4500);
    }
  });
};