import time
import re
import logging
from datetime import datetime
import firebase_admin
from firebase_admin import credentials, firestore
import requests
from bs4 import BeautifulSoup
import os
import json

# --- Configuration ---
try:
    if os.environ.get('FIREBASE_SERVICE_ACCOUNT'):
        cred_dict = json.loads(os.environ.get('FIREBASE_SERVICE_ACCOUNT'))
        cred = credentials.Certificate(cred_dict)
        firebase_admin.initialize_app(cred)
    elif os.path.exists('serviceAccountKey.json'):
        cred = credentials.Certificate('serviceAccountKey.json')
        firebase_admin.initialize_app(cred)
    else:
        config_path = 'firebase-applet-config.json'
        if os.path.exists(config_path):
            with open(config_path, 'r') as f:
                config = json.load(f)
                firebase_admin.initialize_app(options={'projectId': config['projectId']})
        else:
            firebase_admin.initialize_app()
except Exception as e:
    print(f"Firebase initialization warning: {e}")
    try:
        firebase_admin.get_app()
    except ValueError:
        raise e

db = firestore.client()

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
    """Scrapes receive-smss.com for new numbers using requests and BS4."""
    try:
        logging.info("Scraping receive-smss.com...")
        response = requests.get("https://receive-smss.com/", headers=HEADERS, timeout=30)
        response.raise_for_status()
        
        soup = BeautifulSoup(response.text, 'html.parser')
        numbers_data = []
        
        cards = soup.select(".number-boxes-item")
        logging.info(f"Found {len(cards)} number cards.")
        
        for card in cards:
            try:
                num_elem = card.select_one(".number-boxes-item-number")
                if not num_elem: continue
                
                number_text = num_elem.get_text(strip=True)
                clean_number = re.sub(r'\D', '', number_text)
                
                # Check if it's "New"
                is_new = "New" in card.get_text()
                
                if is_new:
                    numbers_data.append({
                        'number': clean_number,
                        'country': 'Unknown',
                        'source': 'receive-smss.com',
                        'status': 'new',
                        'addedAt': firestore.SERVER_TIMESTAMP
                    })
            except Exception as e:
                logging.error(f"Error parsing card: {e}")
                
        return numbers_data
    except Exception as e:
        logging.error(f"Error scraping receive-smss: {e}")
        return []

def monitor_otp(number_doc_id, phone_number):
    """Monitors the inbox of a specific number for a WhatsApp OTP."""
    url = f"https://receive-smss.com/sms/{phone_number}/"
    logging.info(f"Monitoring OTP for {phone_number} at {url}")
    log_to_firestore(f"Started monitoring OTP for {phone_number}")
    
    start_time = time.time()
    timeout = 300 # 5 minutes timeout
    
    while time.time() - start_time < timeout:
        try:
            response = requests.get(url, headers=HEADERS, timeout=30)
            response.raise_for_status()
            
            soup = BeautifulSoup(response.text, 'html.parser')
            rows = soup.select("table tr")
            
            for row in rows:
                text = row.get_text()
                if "WhatsApp" in text or "WhatsApp code" in text:
                    otp_match = re.search(r'\b\d{3}-?\d{3}\b', text)
                    if otp_match:
                        otp = otp_match.group(0).replace('-', '')
                        logging.info(f"OTP Found: {otp}")
                        
                        db.collection('numbers').document(number_doc_id).update({
                            'otp': otp,
                            'status': 'success'
                        })
                        log_to_firestore(f"OTP {otp} detected for {phone_number}", level='info')
                        return True
            
            time.sleep(20) # Poll every 20 seconds
        except Exception as e:
            logging.error(f"Error checking inbox for {phone_number}: {e}")
            time.sleep(10)
            
    logging.warning(f"Timeout reached for {phone_number}")
    try:
        db.collection('numbers').document(number_doc_id).update({'status': 'failed'})
    except: pass
    return False

def main():
    logging.info("Step 1: Scraper Started (Requests/BS4 Mode)")
    log_to_firestore("Step 1: Scraper Started (Requests/BS4 Mode)")
    
    while True:
        try:
            new_numbers = scrape_receive_smss()
            
            for num_data in new_numbers:
                existing = db.collection('numbers').where('number', '==', num_data['number']).limit(1).get()
                
                if not existing:
                    doc_ref = db.collection('numbers').add(num_data)[1]
                    logging.info(f"Step 2: Number Found - {num_data['number']}")
                    log_to_firestore(f"Step 2: Number Found - {num_data['number']}")
                    
                    monitor_otp(doc_ref.id, num_data['number'])
            
            logging.info("Cycle complete. Sleeping for 60s...")
            time.sleep(60)
        except Exception as e:
            logging.error(f"Error in main loop cycle: {e}")
            time.sleep(30)

if __name__ == "__main__":
    main()
