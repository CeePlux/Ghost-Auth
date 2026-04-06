# Ghost-Auth Engine Room Setup

This guide explains how to set up and run the background services for the Ghost-Auth Device Farm on your local machine (WSL2/Linux).

## 1. Prerequisites

### System Tools
*   **Docker & Docker Compose**
*   **ADB (Android Debug Bridge)**
*   **Python 3.10+**
*   **Appium Server** (`npm install -g appium` and `appium driver install uiautomator2`)

### Firebase Service Account
1.  Go to the [Firebase Console](https://console.firebase.google.com/).
2.  Select your project: `gen-lang-client-0472035720`.
3.  Go to **Project Settings** > **Service Accounts**.
4.  Click **Generate new private key**.
5.  Save the JSON file as `serviceAccountKey.json` in the same directory as the Python scripts.

## 2. Python Environment Setup

```bash
# Install dependencies
pip install firebase-admin playwright appium-python-client selenium
playwright install chromium
```

## 3. Running the Services

### Sniffer Service (sniffer.py)
Scrapes SMS sites and monitors for WhatsApp OTPs.
```bash
python sniffer.py
```

### Automator Service (automator.py)
Listens to Firestore and controls the Android Emulator via Appium.
```bash
python automator.py
```

## 4. Live Mirror Bridge (ws-scrcpy)

To see the live feed in your dashboard, run the following Docker command. This bridges your local ADB devices to a WebSocket stream that the React dashboard can consume.

```bash
docker run --rm -it \
  --name ws-scrcpy \
  --privileged \
  -v /dev/bus/usb:/dev/bus/usb \
  --net=host \
  -e ADB_SERVER_SOCKET=tcp:localhost:5037 \
  -p 8000:8000 \
  -p 2020:2020 \
  -p 8080:8080 \
  -p 4723:4723 \
  -p 5554:5554 \
  -p 5555:5555 \
  budtmo/docker-android:latest
```

*Note: If you already have an emulator running, you can use a standalone `ws-scrcpy` container:*

```bash
docker run --rm -it \
  --name ws-scrcpy \
  --net=host \
  -e ADB_HOST=127.0.0.1 \
  -p 8080:8080 \
  -p 2020:2020 \
  suda/ws-scrcpy:latest
```

## 6. Render.com All-in-One Deployment (Free Tier)

To run both the Dashboard and the Sniffer on a single Render Free Web Service:

1.  **Create a Web Service** on Render.
2.  **Connect your GitHub repository**.
3.  **Environment Variables**:
    *   `NODE_ENV`: `production`
    *   `FIREBASE_SERVICE_ACCOUNT`: (Paste the content of your `serviceAccountKey.json`)
4.  **Deployment Method**: Select **Dockerfile**.
5.  **Memory Management**: The sniffer uses Playwright/Chromium, which can be memory-intensive. The provided `Dockerfile` is optimized for the 512MB limit by installing only Chromium and using a single browser instance.
6.  **Keep Alive**: Since Render Free tier spins down after 15 minutes of inactivity, use an external pinger (like Cron-job.org or UptimeRobot) to ping your service URL every 10-14 minutes.

The `server.ts` is configured to automatically launch the `sniffer.py` engine as a child process when the Node.js server starts.
