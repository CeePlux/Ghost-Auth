import makeWASocket, { 
  DisconnectReason, 
  useMultiFileAuthState, 
  fetchLatestBaileysVersion, 
  makeCacheableSignalKeyStore,
  AuthenticationState,
  SignalDataTypeMap
} from "@whiskeysockets/baileys";
import pino from "pino";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";

const DATABASE_ID = "ai-studio-edf518e7-ccd7-4d8a-afd7-3f1030781b80";

export class WhatsAppService {
  private sock: any;
  private status: "disconnected" | "connecting" | "connected" = "disconnected";
  private pairingCode: string | null = null;
  private retryCount = 0;
  private maxRetryDelay = 60000; // 1 minute
  private db = getFirestore(admin.app(), DATABASE_ID);

  async init() {
    const { state, saveCreds } = await this.useFirestoreAuthState("main-session");
    const { version } = await fetchLatestBaileysVersion();

    this.sock = makeWASocket({
      version,
      printQRInTerminal: false,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" }) as any),
      },
      logger: pino({ level: "silent" }) as any,
    });

    this.sock.ev.on("connection.update", (update: any) => {
      const { connection, lastDisconnect } = update;
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

  private async useFirestoreAuthState(sessionId: string) {
    const sessionRef = this.db.collection("sessions").doc(sessionId);
    
    const getSession = async () => {
      const doc = await sessionRef.get();
      return doc.exists ? JSON.parse(doc.data()?.data) : null;
    };

    const saveSession = async (data: any) => {
      await sessionRef.set({
        id: sessionId,
        data: JSON.stringify(data, (key, value) => {
          if (Buffer.isBuffer(value)) return value.toString("base64");
          return value;
        }),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    };

    // Load initial creds
    let creds = await getSession();
    if (!creds) {
      creds = {
        noiseKey: Buffer.from(new Uint8Array(32)),
        signedIdentityKey: Buffer.from(new Uint8Array(32)),
        signedPreKey: Buffer.from(new Uint8Array(32)),
        registrationId: Math.floor(Math.random() * 16384),
        advSecretKey: Buffer.from(new Uint8Array(32)),
        processedHistoryMessages: [],
        nextPreKeyId: 1,
        firstUnuploadedPreKeyId: 1,
        accountSettings: { unarchiveChats: false },
        registered: false,
        pairingEphemeralKeyPair: Buffer.from(new Uint8Array(32)),
        serverHasPreKeys: false,
      };
    } else {
      // Decode buffers
      const decode = (obj: any) => {
        for (const key in obj) {
          if (typeof obj[key] === "string" && obj[key].length > 20 && !obj[key].includes(" ")) {
            try {
              obj[key] = Buffer.from(obj[key], "base64");
            } catch (e) {}
          } else if (typeof obj[key] === "object") {
            decode(obj[key]);
          }
        }
      };
      decode(creds);
    }

    return {
      state: {
        creds,
        keys: {
          get: async (type: keyof SignalDataTypeMap, ids: string[]) => {
            const data: any = {};
            for (const id of ids) {
              const keyDoc = await sessionRef.collection("keys").doc(`${type}-${id}`).get();
              if (keyDoc.exists) {
                const val = JSON.parse(keyDoc.data()?.data);
                data[id] = Buffer.isBuffer(val) ? val : Buffer.from(val, "base64");
              }
            }
            return data;
          },
          set: async (data: any) => {
            for (const type in data) {
              for (const id in data[type]) {
                const val = data[type][id];
                await sessionRef.collection("keys").doc(`${type}-${id}`).set({
                  data: JSON.stringify(val, (key, value) => {
                    if (Buffer.isBuffer(value)) return value.toString("base64");
                    return value;
                  })
                });
              }
            }
          }
        }
      },
      saveCreds: () => saveSession(creds)
    };
  }
}
