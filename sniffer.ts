import { chromium } from 'playwright-extra';
import stealth from 'playwright-stealth';
import { Browser, Page } from 'playwright';
import admin from 'firebase-admin';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import axios from 'axios';

// Use stealth plugin
chromium.use(stealth());

const API_URL = process.env.APP_URL || 'http://localhost:3000';

// --- Firebase Initialization ---
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = getFirestore();
const GHOST_LIMIT = 5;

async function logToFirestore(message: string, level: string = 'info', deviceId?: string) {
  try {
    await db.collection('logs').add({
      timestamp: FieldValue.serverTimestamp(),
      level,
      message,
      deviceId: deviceId || null
    });
    console.log(`[${level.toUpperCase()}] ${message}`);
  } catch (err) {
    console.error("Failed to log to Firestore:", err);
  }
}

async function getActiveGhostCount() {
  const snapshot = await db.collection('numbers').where('status', '==', 'active').get();
  return snapshot.size;
}

async function setupPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
  });
  
  const page = await context.newPage();
  
  // Apply Stealth
  // @ts-ignore
  // await stealth(page); // stealth is usually applied to context or browser in some versions, but playwright-stealth is often used like this:
  
  // Resource Blocking for Ultra-Light Memory Usage
  await page.route('**/*', (route) => {
    const type = route.request().resourceType();
    if (['image', 'stylesheet', 'font', 'media'].includes(type)) {
      route.abort();
    } else {
      route.continue();
    }
  });

  return page;
}

async function scrapeReceiveSmss(page: Page) {
  try {
    await logToFirestore("Scraping receive-smss.com with Playwright...");
    await page.goto("https://receive-smss.com/", { waitUntil: 'domcontentloaded', timeout: 60000 });
    
    const numbers = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll(".number-boxes-item"));
      return cards.map(card => {
        const numElem = card.querySelector(".number-boxes-item-number");
        const countryElem = card.querySelector(".number-boxes-item-country");
        const linkElem = card.querySelector("a");
        return {
          number: numElem?.textContent?.replace(/\s+/g, '').trim(),
          country: countryElem?.textContent?.trim(),
          url: linkElem?.href,
          source: 'receive-smss.com'
        };
      }).filter(n => n.number);
    });

    return numbers;
  } catch (err: any) {
    await logToFirestore(`Error scraping receive-smss: ${err.message}`, "error");
    return [];
  }
}

async function scrapeTextVerified(page: Page) {
  try {
    await logToFirestore("Scraping textverified.com/free with Playwright...");
    await page.goto("https://www.textverified.com/free", { waitUntil: 'domcontentloaded', timeout: 60000 });
    
    const numbers = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll(".free-number-card"));
      return cards.map(card => {
        const numElem = card.querySelector(".number");
        const countryElem = card.querySelector(".country");
        const linkElem = card.querySelector("a");
        return {
          number: numElem?.textContent?.replace(/\s+/g, '').trim(),
          country: countryElem?.textContent?.trim(),
          url: linkElem?.href,
          source: 'textverified.com'
        };
      }).filter(n => n.number);
    });

    return numbers;
  } catch (err: any) {
    await logToFirestore(`Error scraping textverified: ${err.message}`, "error");
    return [];
  }
}

async function scrapeVeepn(page: Page) {
  try {
    await logToFirestore("Scraping veepn.com/online-sms with Playwright...");
    await page.goto("https://veepn.com/online-sms/", { waitUntil: 'domcontentloaded', timeout: 60000 });
    
    const numbers = await page.evaluate(() => {
      // Assuming structure based on common patterns if not specified
      const links = Array.from(document.querySelectorAll("a[href*='/online-sms/number-']"));
      return links.map(link => {
        const text = link.textContent?.trim() || "";
        return {
          number: text.includes("+") ? text.replace(/\s+/g, '') : null,
          country: 'Global',
          url: (link as HTMLAnchorElement).href,
          source: 'veepn.com'
        };
      }).filter(n => n.number);
    });

    return numbers;
  } catch (err: any) {
    await logToFirestore(`Error scraping veepn: ${err.message}`, "error");
    return [];
  }
}

async function monitorActivation(page: Page, docId: string, url: string) {
  await logToFirestore(`Monitoring activation for ${docId} at ${url}`);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    
    // Refresh loop
    for (let i = 0; i < 30; i++) { // Max 5 minutes (30 * 10s)
      await page.reload({ waitUntil: 'domcontentloaded' });
      const content = await page.content();
      
      // Look for WhatsApp and 6-digit code
      const match = content.match(/WhatsApp.*?(\d{6})/i) || content.match(/(\d{6}).*?WhatsApp/i);
      
      if (match) {
        const code = match[1];
        await logToFirestore(`FOUND WHATSAPP CODE: ${code} for ${docId}`);
        
        // Update Firestore
        await db.collection('numbers').doc(docId).update({
          otpCode: code,
          status: 'code_received',
          updatedAt: FieldValue.serverTimestamp()
        });

        // Notify Backend
        try {
          await axios.post(`${API_URL}/api/sniffer/code`, { docId, code });
        } catch (err: any) {
          console.error(`Failed to notify backend: ${err.message}`);
        }
        
        return true;
      }
      
      await new Promise(resolve => setTimeout(resolve, 10000));
      
      // Check if status changed (e.g. cancelled)
      const doc = await db.collection('numbers').doc(docId).get();
      if (doc.data()?.status !== 'activating') {
        await logToFirestore(`Activation cancelled for ${docId}`);
        return false;
      }
    }
    
    await db.collection('numbers').doc(docId).update({
      status: 'timeout',
      updatedAt: FieldValue.serverTimestamp()
    });
    await logToFirestore(`Activation timeout for ${docId}`);
  } catch (err: any) {
    await logToFirestore(`Error monitoring activation: ${err.message}`, "error");
  }
  return false;
}

async function saveNumbers(numbers: any[]) {
  for (const num of numbers) {
    try {
      const q = await db.collection('numbers').where('number', '==', num.number).get();
      if (q.empty) {
        await db.collection('numbers').add({
          ...num,
          status: 'found',
          addedAt: FieldValue.serverTimestamp()
        });
        await logToFirestore(`New number found: ${num.number} (${num.source})`);
      }
    } catch (err: any) {
      console.error(`Error saving number ${num.number}:`, err.message);
    }
  }
}

async function main() {
  await logToFirestore("Stealth-Light Scavenger Engine Started");

  const browser = await chromium.launch({
    args: ['--disable-setuid-sandbox', '--no-sandbox', '--disable-dev-shm-usage', '--single-process']
  });

  try {
    while (true) {
      // 1. Check for Activating Numbers
      const activatingSnapshot = await db.collection('numbers').where('status', '==', 'activating').limit(1).get();
      if (!activatingSnapshot.empty) {
        const doc = activatingSnapshot.docs[0];
        const data = doc.data();
        if (data.url) {
          const page = await setupPage(browser);
          await monitorActivation(page, doc.id, data.url);
          await page.close();
        }
      }

      // 2. Check Ghost Limit
      const activeCount = await getActiveGhostCount();
      if (activeCount >= GHOST_LIMIT) {
        await logToFirestore(`Ghost Limit Reached (${activeCount}/${GHOST_LIMIT}). Scavenger sleeping...`);
        await new Promise(resolve => setTimeout(resolve, 60000));
        continue;
      }

      // 3. Scrape for New Numbers
      const page = await setupPage(browser);
      const s1 = await scrapeReceiveSmss(page);
      const s2 = await scrapeTextVerified(page);
      const s3 = await scrapeVeepn(page);
      await page.close();

      const allNumbers = [...s1, ...s2, ...s3];
      if (allNumbers.length > 0) {
        await saveNumbers(allNumbers);
      }

      console.log("Main loop cycle complete. Sleeping for 60s...");
      await new Promise(resolve => setTimeout(resolve, 60000));
    }
  } catch (err: any) {
    await logToFirestore(`CRITICAL ENGINE FAILURE: ${err.message}`, "error");
  } finally {
    await browser.close();
  }
}

main().catch(async err => {
  console.error("Fatal error in main:", err);
  process.exit(1);
});
