import admin from "firebase-admin";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Initialize Firebase Admin at the very top
const PROJECT_ID = "gen-lang-client-0472035720";
const DATABASE_ID = "ai-studio-edf518e7-ccd7-4d8a-afd7-3f1030781b80";

if (!admin.apps.length) {
  const serviceAccountVar = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (serviceAccountVar) {
    try {
      const serviceAccount = JSON.parse(serviceAccountVar);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: PROJECT_ID
      });
      console.log(`[Firebase] Initialized with service account from environment (Project: ${PROJECT_ID}).`);
      console.log('Firebase Initialized');
    } catch (e) {
      console.error("[Firebase] Failed to parse FIREBASE_SERVICE_ACCOUNT:", e);
    }
  } else {
    try {
      const configPath = path.resolve(process.cwd(), "firebase-applet-config.json");
      const firebaseConfig = JSON.parse(readFileSync(configPath, "utf-8"));
      admin.initializeApp({
        projectId: firebaseConfig.projectId || PROJECT_ID,
      });
      console.log("[Firebase] Initialized with project ID from config.");
      console.log('Firebase Initialized');
    } catch (e) {
      console.error("[Firebase] Failed to initialize Firebase from config:", e);
    }
  }
}

import express from "express";
import { createServer as createViteServer } from "vite";
import { WhatsAppService } from "./src/services/whatsapp-service.ts";
import { spawn, ChildProcess } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let snifferProcess: ChildProcess | null = null;

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    
    // Auto-launch sniffer on startup
    if (!snifferProcess) {
      console.log("[Server] Auto-launching sniffer engine...");
      const pythonCmd = process.platform === "win32" ? "python" : "python3";
      
      snifferProcess = spawn(pythonCmd, ["sniffer.py"], {
        stdio: "pipe",
        env: { ...process.env, PYTHONUNBUFFERED: "1" }
      });

      snifferProcess.stdout?.on("data", (data) => {
        console.log(`[Sniffer STDOUT] ${data.toString().trim()}`);
      });

      snifferProcess.stderr?.on("data", (data) => {
        console.error(`[Sniffer STDERR] ${data.toString().trim()}`);
      });

      snifferProcess.on("exit", (code, signal) => {
        console.log(`[Server] Sniffer process exited with code ${code} and signal ${signal}. Restarting in 10s...`);
        snifferProcess = null;
        setTimeout(() => {
          if (process.env.NODE_ENV === "production") {
            // In production, we might want to auto-restart if it wasn't a manual kill
            // For now, let's just log it. The user can toggle it from the UI.
          }
        }, 10000);
      });
    }
  });

  app.use(express.json());

  const waService = new WhatsAppService();
  
  // Initialize WhatsApp service in the background
  waService.init().catch(err => {
    console.error("Failed to initialize WhatsApp service:", err);
  });

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  let isProcessing = false;

  app.post("/api/whatsapp/pair", async (req, res) => {
    res.status(501).json({ error: "Manual pairing is disabled. Use the automated Scavenger Farm." });
  });

  app.get("/api/whatsapp/status", (req, res) => {
    res.json({ status: "Automated Farm Active" });
  });

  // Sniffer Control
  app.get("/api/sniffer/status", (req, res) => {
    res.json({ active: snifferProcess !== null });
  });

  app.post("/api/sniffer/toggle", (req, res) => {
    if (snifferProcess) {
      console.log("[Server] Stopping sniffer process...");
      snifferProcess.kill();
      snifferProcess = null;
      res.json({ active: false });
    } else {
      console.log("[Server] Starting sniffer process...");
      // Try python3 first, then fallback to python
      const pythonCmd = process.platform === "win32" ? "python" : "python3";
      
      snifferProcess = spawn(pythonCmd, ["sniffer.py"], {
        stdio: "pipe", // Change to pipe to capture output
        env: { ...process.env, PYTHONUNBUFFERED: "1" }
      });

      snifferProcess.stdout?.on("data", (data) => {
        console.log(`[Sniffer STDOUT] ${data.toString().trim()}`);
      });

      snifferProcess.stderr?.on("data", (data) => {
        console.error(`[Sniffer STDERR] ${data.toString().trim()}`);
      });

      snifferProcess.on("error", (err) => {
        console.error("[Server] Failed to start sniffer process:", err);
        snifferProcess = null;
      });

      snifferProcess.on("exit", (code, signal) => {
        console.log(`[Server] Sniffer process exited with code ${code} and signal ${signal}`);
        snifferProcess = null;
      });

      res.json({ active: true });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }
}

startServer();
