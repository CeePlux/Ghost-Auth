import os
import json
import firebase_admin
from firebase_admin import credentials
from google.cloud import firestore
from google.oauth2 import service_account

print("--- SNIFFER.PY EXECUTION START ---")

# --- Firebase Initialization at the very top ---
PROJECT_ID = "gen-lang-client-0472035720"
DATABASE_ID = "ai-studio-edf518e7-ccd7-4d8a-afd7-3f1030781b80"

if not firebase_admin._apps:
    try:
        if os.environ.get('FIREBASE_SERVICE_ACCOUNT'):
            service_account_info = json.loads(os.environ.get('FIREBASE_SERVICE_ACCOUNT'))
            cred = credentials.Certificate(service_account_info)
            firebase_admin.initialize_app(cred, {
                'projectId': PROJECT_ID
            })
            print(f"[Firebase] Initialized with service account from environment (Project: {PROJECT_ID}).")
            
            # Create explicit credentials for the direct Firestore client
            google_creds = service_account.Credentials.from_service_account_info(service_account_info)
            db = firestore.Client(project=PROJECT_ID, database=DATABASE_ID, credentials=google_creds)
        elif os.path.exists('serviceAccountKey.json'):
            cred = credentials.Certificate('serviceAccountKey.json')
            firebase_admin.initialize_app(cred)
            print("[Firebase] Initialized with serviceAccountKey.json.")
            
            # Create explicit credentials for the direct Firestore client
            google_creds = service_account.Credentials.from_service_account_file('serviceAccountKey.json')
            db = firestore.Client(project=PROJECT_ID, database=DATABASE_ID, credentials=google_creds)
        else:
            config_path = 'firebase-applet-config.json'
            if os.path.exists(config_path):
                with open(config_path, 'r') as f:
                    config = json.load(f)
                    firebase_admin.initialize_app(options={'projectId': config.get('projectId', PROJECT_ID)})
                    print(f"[Firebase] Initialized with project ID from config: {config.get('projectId')}")
            else:
                firebase_admin.initialize_app()
                print("[Firebase] Initialized with default credentials.")
            db = firestore.Client(project=PROJECT_ID, database=DATABASE_ID)
        print('Firebase Initialized')
    except Exception as e:
        print(f"Firebase initialization fatal error: {e}")
        raise e

import time
import re
import logging
from datetime import datetime
import requests
from bs4 import BeautifulSoup
import gc

# --- Configuration ---

logging.basicConfig(
    level=logging.INFO, 
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler("sniffer.log")
    ]
)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

def log_to_firestore(message, level='info', device_id=None):
    try:
        db.collection('logs').add({
            'timestamp': firestore.SERVER_TIMESTAMP,
            'level': level,
            'message': message,
            'deviceId': device_id
        })
    except Exception as e:
        logging.error(f"Failed to log to Firestore: {e}")

def scrape_receive_smss():
    """Scrapes receive-smss.com for new numbers."""
    try:
        logging.info("Scraping receive-smss.com...")
        response = requests.get("https://receive-smss.com/", headers=HEADERS, timeout=30)
        logging.info(f"Status Code (receive-smss.com): {response.status_code}")
        log_to_firestore(f"Status Code (receive-smss.com): {response.status_code}")
        
        # Heartbeat Check: Log first 2000 chars
        log_to_firestore(f"Heartbeat Check (2000 chars): {response.text[:2000]}")
        
        if "Cloudflare" in response.text or "Access Denied" in response.text:
            logging.error("BLOCKED by Cloudflare/Access Denied on receive-smss.com")
            log_to_firestore("BLOCKED by Cloudflare on receive-smss.com", level='error')
        else:
            log_to_firestore("Heartbeat: No Cloudflare detected.", level='info')
            
        response.raise_for_status()
        soup = BeautifulSoup(response.text, 'html.parser')
        numbers_data = []
        cards = soup.select(".number-boxes-item")
        logging.info(f"Found {len(cards)} cards on receive-smss.com")
        log_to_firestore(f"Found {len(cards)} cards on receive-smss.com")
        for card in cards:
            try:
                num_elem = card.select_one(".number-boxes-item-number")
                if not num_elem: continue
                clean_number = re.sub(r'\D', '', num_elem.get_text(strip=True))
                if "New" in card.get_text():
                    numbers_data.append({
                        'number': clean_number,
                        'source': 'receive-smss.com',
                        'status': 'found',
                        'addedAt': firestore.SERVER_TIMESTAMP
                    })
            except: pass
        del soup
        gc.collect()
        return numbers_data
    except Exception as e:
        logging.error(f"Error scraping receive-smss: {e}")
        return []

def scrape_receive_sms_free():
    """Scrapes receive-sms-free.cc for new numbers."""
    try:
        logging.info("Scraping receive-sms-free.cc...")
        response = requests.get("https://receive-sms-free.cc/", headers=HEADERS, timeout=30)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, 'html.parser')
        numbers_data = []
        # Example selector, might need adjustment
        links = soup.select("a[href*='/free-sms-number/']")
        for link in links:
            try:
                text = link.get_text(strip=True)
                clean_number = re.sub(r'\D', '', text)
                if len(clean_number) > 8:
                    numbers_data.append({
                        'number': clean_number,
                        'source': 'receive-sms-free.cc',
                        'status': 'found',
                        'addedAt': firestore.SERVER_TIMESTAMP
                    })
            except: pass
        del soup
        gc.collect()
        return numbers_data
    except Exception as e:
        logging.error(f"Error scraping receive-sms-free: {e}")
        return []

def scrape_mobilesms_free():
    """Scrapes mobilesms.io/free for new numbers."""
    try:
        logging.info("Scraping mobilesms.io/free...")
        response = requests.get("https://mobilesms.io/free-sms-numbers/", headers=HEADERS, timeout=30)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, 'html.parser')
        numbers_data = []
        # Example selector
        items = soup.select(".free-number-item")
        for item in items:
            try:
                num_text = item.get_text(strip=True)
                clean_number = re.sub(r'\D', '', num_text)
                if len(clean_number) > 8:
                    numbers_data.append({
                        'number': clean_number,
                        'source': 'mobilesms.io',
                        'status': 'found',
                        'addedAt': firestore.SERVER_TIMESTAMP
                    })
            except: pass
        del soup
        gc.collect()
        return numbers_data
    except Exception as e:
        logging.error(f"Error scraping mobilesms: {e}")
        return []

def monitor_otp(number_doc_id, phone_number, source):
    """Monitors the inbox of a specific number for a WhatsApp OTP."""
    url = ""
    if source == 'receive-smss.com':
        url = f"https://receive-smss.com/sms/{phone_number}/"
    elif source == 'receive-sms-free.cc':
        url = f"https://receive-sms-free.cc/free-sms-number/{phone_number}.html"
    elif source == 'mobilesms.io':
        url = f"https://mobilesms.io/free-sms-numbers/{phone_number}/"
    
    if not url: return False

    logging.info(f"Monitoring OTP for {phone_number} at {url}")
    
    start_time = time.time()
    timeout = 600 # 10 minutes timeout
    
    while time.time() - start_time < timeout:
        try:
            # Check if we should still monitor (e.g. status changed to 'requesting_otp' by Node.js)
            doc = db.collection('numbers').document(number_doc_id).get()
            if not doc.exists: break
            status = doc.to_dict().get('status')
            
            # Only monitor if Node.js has triggered the OTP request
            if status == 'requesting_otp':
                response = requests.get(url, headers=HEADERS, timeout=30)
                response.raise_for_status()
                soup = BeautifulSoup(response.text, 'html.parser')
                text = soup.get_text()
                
                # Look for WhatsApp OTP
                otp_match = re.search(r'WhatsApp(?: code)?:?\s*(\d{3}-?\d{3})', text, re.IGNORECASE)
                if otp_match:
                    otp = otp_match.group(1).replace('-', '')
                    logging.info(f"OTP Found for {phone_number}: {otp}")
                    db.collection('numbers').document(number_doc_id).update({
                        'otp': otp,
                        'status': 'otp_found'
                    })
                    del soup
                    gc.collect()
                    return True
                del soup
                gc.collect()
            
            time.sleep(15)
        except Exception as e:
            logging.error(f"Error monitoring {phone_number}: {e}")
            time.sleep(10)
            
    return False

def main():
    logging.info("Scavenger Farm Engine Started")
    log_to_firestore("Scavenger Farm Engine Started")
    
    # Force a Save: Test Number to confirm DB connection
    try:
        test_num = {
            'number': 'TEST_NUMBER_12345',
            'source': 'heartbeat_check',
            'status': 'found',
            'addedAt': firestore.SERVER_TIMESTAMP
        }
        db.collection('numbers').add(test_num)
        logging.info("Force Save Successful: Test Number added to Firestore.")
        log_to_firestore("Force Save Successful: Test Number added to Firestore.")
    except Exception as e:
        logging.error(f"Force Save FAILED: {e}")

    while True:
        try:
            all_found = []
            all_found.extend(scrape_receive_smss())
            all_found.extend(scrape_receive_sms_free())
            all_found.extend(scrape_mobilesms_free())
            
            for num_data in all_found:
                # Check if number already exists
                existing = db.collection('numbers').where('number', '==', num_data['number']).limit(1).get()
                
                if not existing:
                    doc_ref = db.collection('numbers').add(num_data)[1]
                    logging.info(f"New Scavenged Number: {num_data['number']}")
                    log_to_firestore(f"New Scavenged Number: {num_data['number']}")
                    
                    # Start a thread or just monitor in sequence (for now sequence is simpler)
                    # In a real farm we'd use threading, but let's keep it simple for now
                    monitor_otp(doc_ref.id, num_data['number'], num_data['source'])
            
            logging.info("Cycle complete. Sleeping 10 minutes...")
            gc.collect()
            time.sleep(600)
        except Exception as e:
            logging.error(f"Main loop error: {e}")
            time.sleep(60)

if __name__ == "__main__":
    main()
