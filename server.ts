import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { WhatsAppService } from "./src/services/whatsapp-service.ts";
import { spawn, ChildProcess } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let snifferProcess: ChildProcess | null = null;

async function startServer() {
  const app = express();
  const PORT = 3000;

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
    const { phoneNumber } = req.body;
    if (!phoneNumber) return res.status(400).json({ error: "Phone number required" });
    
    if (isProcessing) {
      return res.status(429).json({ error: "Another registration is in progress. Please wait." });
    }

    isProcessing = true;
    try {
      const code = await waService.requestPairingCode(phoneNumber);
      res.json({ code });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    } finally {
      isProcessing = false;
      // Memory management: Suggest GC if enabled
      if (global.gc) {
        console.log("[Server] Triggering manual GC...");
        global.gc();
      }
    }
  });

  app.get("/api/whatsapp/status", (req, res) => {
    res.json({ status: waService.getStatus() });
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
          // Restart logic could go here if needed
        }, 10000);
      });
    }
  });
}

startServer();
