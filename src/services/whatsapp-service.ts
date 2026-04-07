import { 
  makeWASocket,
  DisconnectReason, 
  useMultiFileAuthState, 
  fetchLatestBaileysVersion, 
  makeCacheableSignalKeyStore
} from "@whiskeysockets/baileys";
import pino from "pino";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import { mkdirSync, existsSync } from "fs";

const DATABASE_ID = "ai-studio-edf518e7-ccd7-4d8a-afd7-3f1030781b80";

export class WhatsAppService {
  private sock: any;
  private status: "disconnected" | "connecting" | "connected" = "disconnected";
  private pairingCode: string | null = null;
  private retryCount = 0;
  private maxRetryDelay = 60000; // 1 minute
  private db = getFirestore(admin.app(), DATABASE_ID);

  async init() {
    const authPath = "/app/auth_info";
    if (!existsSync(authPath)) {
      mkdirSync(authPath, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(authPath);
    const { version } = await fetchLatestBaileysVersion();

    this.sock = makeWASocket({
      version,
      printQRInTerminal: true, // Log QR code to terminal
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" }) as any),
      },
      logger: pino({ level: "silent" }) as any,
      connectTimeoutMs: 60000, // 60 seconds timeout
    });

    this.sock.ev.on("connection.update", (update: any) => {
      const { connection, lastDisconnect, qr } = update;
      
      if (qr) {
        console.log("[WhatsApp] QR Code received. Please scan to link account:", qr);
      }

      if (connection === "close") {
        const shouldReconnect = (lastDisconnect?.error as any)?.output?.statusCode !== DisconnectReason.loggedOut;
        this.status = "disconnected";
        
        if (shouldReconnect) {
          const delay = Math.min(Math.pow(2, this.retryCount) * 1000, this.maxRetryDelay);
          console.log(`[WhatsApp] Connection lost. Reconnecting in ${delay}ms (Attempt ${this.retryCount + 1})`);
          
          setTimeout(() => {
            this.retryCount++;
            this.init();
          }, delay);
        } else {
          console.log("[WhatsApp] Connection closed. Logged out.");
          this.retryCount = 0;
        }
      } else if (connection === "open") {
        console.log("[WhatsApp] Connection established.");
        this.status = "connected";
        this.pairingCode = null;
        this.retryCount = 0;
      } else if (connection === "connecting") {
        console.log("Step 3: Connecting to WhatsApp");
        this.status = "connecting";
      }
    });

    this.sock.ev.on("creds.update", saveCreds);
  }

  async requestPairingCode(phoneNumber: string) {
    if (this.status === "connected") throw new Error("Already connected");
    
    // Clean phone number
    const cleanNumber = phoneNumber.replace(/\D/g, "");
    this.pairingCode = await this.sock.requestPairingCode(cleanNumber);
    return this.pairingCode;
  }

  getStatus() {
    return {
      status: this.status,
      pairingCode: this.pairingCode
    };
  }
}
