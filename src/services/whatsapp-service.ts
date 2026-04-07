import { 
  makeWASocket,
  DisconnectReason, 
  useMultiFileAuthState, 
  fetchLatestBaileysVersion, 
  makeCacheableSignalKeyStore,
  delay
} from "@whiskeysockets/baileys";
import pino from "pino";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import { mkdirSync, existsSync, readdirSync } from "fs";
import path from "path";

const DATABASE_ID = "ai-studio-edf518e7-ccd7-4d8a-afd7-3f1030781b80";

export class WhatsAppService {
  private sessions: Map<string, any> = new Map();
  private db = getFirestore(admin.app(), DATABASE_ID);
  private authRoot = path.join(process.cwd(), "auth_info");

  constructor() {
    if (!existsSync(this.authRoot)) {
      mkdirSync(this.authRoot, { recursive: true });
    }
  }

  async init() {
    console.log("[WhatsApp] Initializing Scavenger Farm Service...");
    
    // Load existing sessions
    const sessionDirs = readdirSync(this.authRoot);
    for (const dir of sessionDirs) {
      if (dir.startsWith("ghost_")) {
        const number = dir.replace("ghost_", "");
        this.startGhostSession(number);
      }
    }

    // Listen for new scavenged numbers
    this.db.collection("numbers").onSnapshot((snapshot) => {
      snapshot.docChanges().forEach(async (change) => {
        if (change.type === "added" || change.type === "modified") {
          const data = change.doc.data();
          if (data.status === "found") {
            this.processNewNumber(change.doc.id, data.number);
          } else if (data.status === "otp_found" && data.otp) {
            this.activateGhost(change.doc.id, data.number, data.otp);
          }
        }
      });
    });

    // Start Survival Layer Cron (Presence simulation)
    setInterval(() => this.runSurvivalLayer(), 20 * 60 * 1000); // Every 20 mins
  }

  private async processNewNumber(docId: string, number: string) {
    console.log(`[WhatsApp] Filtering number: ${number}`);
    try {
      const { version } = await fetchLatestBaileysVersion();
      const tempSock = makeWASocket({
        version,
        logger: pino({ level: "silent" }) as any,
        auth: { creds: {} as any, keys: {} as any }, // Dummy auth for check
      });

      // Check if number is on WhatsApp
      const [result] = await tempSock.onWhatsApp(number);
      if (result && result.exists) {
        console.log(`[WhatsApp] Number ${number} is already on WhatsApp. Skipping.`);
        await this.db.collection("numbers").doc(docId).update({ status: "skipped_exists" });
        return;
      }

      // Request OTP
      console.log(`[WhatsApp] Requesting OTP for ${number}...`);
      await (tempSock as any).requestRegistrationCode({
        phoneNumber: number,
        phoneNumberCountryCode: number.startsWith("1") ? "1" : "44", // Simple heuristic
        phoneNumberNationalNumber: number.slice(number.startsWith("1") ? 1 : 2),
        method: "sms"
      });

      await this.db.collection("numbers").doc(docId).update({ status: "requesting_otp" });
    } catch (e) {
      console.error(`[WhatsApp] Error processing ${number}:`, e);
      await this.db.collection("numbers").doc(docId).update({ status: "error_filter" });
    }
  }

  private async activateGhost(docId: string, number: string, otp: string) {
    console.log(`[WhatsApp] Activating Ghost: ${number} with OTP: ${otp}`);
    const sessionPath = path.join(this.authRoot, `ghost_${number}`);
    if (!existsSync(sessionPath)) mkdirSync(sessionPath, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" }) as any),
      },
      logger: pino({ level: "silent" }) as any,
    });

    try {
      await (sock as any).register(otp);
      console.log(`[WhatsApp] Ghost ${number} Activated Successfully!`);
      
      sock.ev.on("creds.update", saveCreds);
      this.sessions.set(number, sock);

      await this.db.collection("numbers").doc(docId).update({ status: "active_ghost" });
      
      // Initial Warm-up
      await this.warmUpGhost(number, sock);
      
      // Profile Randomizer
      await this.randomizeProfile(sock);

    } catch (e) {
      console.error(`[WhatsApp] Activation failed for ${number}:`, e);
      await this.db.collection("numbers").doc(docId).update({ status: "activation_failed" });
    }
  }

  private async startGhostSession(number: string) {
    console.log(`[WhatsApp] Starting Ghost Session: ${number}`);
    const sessionPath = path.join(this.authRoot, `ghost_${number}`);
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" }) as any),
      },
      logger: pino({ level: "silent" }) as any,
    });

    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", (update) => {
      if (update.connection === "open") {
        this.sessions.set(number, sock);
      }
    });
  }

  private async runSurvivalLayer() {
    console.log("[Survival] Running presence simulation for all Ghosts...");
    for (const [number, sock] of this.sessions.entries()) {
      try {
        // Toggle presence
        await sock.sendPresenceUpdate("available");
        await delay(2000);
        if (Math.random() > 0.5) {
          await sock.sendPresenceUpdate("composing", "status@broadcast");
        }
        console.log(`[Survival] Presence updated for ${number}`);
      } catch (e) {}
    }
  }

  private async randomizeProfile(sock: any) {
    try {
      const statuses = ["Available", "Busy", "At school", "At the movies", "Battery about to die"];
      const status = statuses[Math.floor(Math.random() * statuses.length)];
      await sock.updateProfileStatus(status);
      
      // In a real app we'd set a random image URL, but let's just set status for now
      console.log("[Survival] Profile randomized.");
    } catch (e) {}
  }

  private async warmUpGhost(number: string, sock: any) {
    try {
      // Find another active ghost to ping
      const otherGhosts = Array.from(this.sessions.keys()).filter(n => n !== number);
      if (otherGhosts.length > 0) {
        const target = otherGhosts[0] + "@s.whatsapp.net";
        await sock.sendMessage(target, { text: "Ping" });
        console.log(`[Warm-up] ${number} pinged ${otherGhosts[0]}`);
      }
    } catch (e) {}
  }
}
