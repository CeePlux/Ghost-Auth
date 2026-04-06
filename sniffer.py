import time
import re
import logging
from datetime import datetime
import firebase_admin
from firebase_admin import credentials, firestore
from playwright.sync_api import sync_playwright

import os
import json

# --- Configuration ---
# 1. Download your service account key from Firebase Console -> Project Settings -> Service Accounts
# 2. Rename it to 'serviceAccountKey.json' and place it in this directory.
# In Cloud environment, we use an environment variable for the service account JSON
cred_json = os.environ.get('FIREBASE_SERVICE_ACCOUNT')
if cred_json:
    cred_dict = json.loads(cred_json)
    cred = credentials.Certificate(cred_dict)
else:
    # Fallback for local testing
    cred = credentials.Certificate('serviceAccountKey.json')

firebase_admin.initialize_app(cred)
db = firestore.client()

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

def log_to_firestore(message, level='info', device_id=None):
    db.collection('logs').add({
        'timestamp': firestore.SERVER_TIMESTAMP,
        'level': level,
        'message': message,
        'deviceId': device_id
    })

def scrape_receive_smss(page):
    """Scrapes receive-smss.com for new numbers."""
    try:
        page.goto("https://receive-smss.com/", wait_until="networkidle")
        numbers_data = []
        
        # Selector for number cards (this may change, adjust if needed)
        cards = page.query_selector_all(".number-boxes-item")
        for card in cards:
            number_text = card.query_selector(".number-boxes-item-number").inner_text().strip()
            # Clean number (remove + and spaces)
            clean_number = re.sub(r'\D', '', number_text)
            
            # Check if it's "New"
            is_new = "New" in card.inner_text()
            
            if is_new:
                numbers_data.append({
                    'number': clean_number,
                    'country': 'Unknown', # Could be parsed from flag icon
                    'source': 'receive-smss.com',
                    'status': 'new',
                    'addedAt': firestore.SERVER_TIMESTAMP
                })
        return numbers_data
    except Exception as e:
        logging.error(f"Error scraping receive-smss: {e}")
        return []

def monitor_otp(page, number_doc_id, phone_number):
    """Monitors the inbox of a specific number for a WhatsApp OTP."""
    url = f"https://receive-smss.com/sms/{phone_number}/"
    logging.info(f"Monitoring OTP for {phone_number} at {url}")
    
    start_time = time.time()
    timeout = 300 # 5 minutes timeout
    
    while time.time() - start_time < timeout:
        try:
            page.goto(url, wait_until="networkidle")
            page.reload()
            
            # Look for WhatsApp OTP pattern in the table
            # Example: "Your WhatsApp code is 123-456"
            rows = page.query_selector_all("table tr")
            for row in rows:
                text = row.inner_text()
                if "WhatsApp" in text or "WhatsApp code" in text:
                    otp_match = re.search(r'\b\d{3}-?\d{3}\b', text)
                    if otp_match:
                        otp = otp_match.group(0).replace('-', '')
                        logging.info(f"OTP Found: {otp}")
                        
                        # Update Firestore
                        db.collection('numbers').document(number_doc_id).update({
                            'otp': otp,
                            'status': 'processing'
                        })
                        log_to_firestore(f"OTP {otp} detected for {phone_number}", level='info')
                        return True
            
            time.sleep(10) # Poll every 10 seconds
        except Exception as e:
            logging.error(f"Error checking inbox: {e}")
            time.sleep(5)
            
    logging.warning(f"Timeout reached for {phone_number}")
    db.collection('numbers').document(number_doc_id).update({'status': 'failed'})
    return False

def main():
    with sync_playwright() as p:
        # Use a realistic User-Agent to avoid detection
        user_agent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36"
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(user_agent=user_agent)
        page = context.new_page()
        
        logging.info("Sniffer Service Started with Stealth Profile")
        log_to_firestore("Sniffer Service Started with Stealth Profile")
        
        while True:
            # 1. Scrape for new numbers
            new_numbers = scrape_receive_smss(page)
            
            for num_data in new_numbers:
                # Check if number already exists in DB
                existing = db.collection('numbers').where('number', '==', num_data['number']).limit(1).get()
                
                if not existing:
                    doc_ref = db.collection('numbers').add(num_data)[1]
                    logging.info(f"New number detected: {num_data['number']}")
                    log_to_firestore(f"New number detected: {num_data['number']}")
                    
                    # 2. If we just added it, start monitoring for OTP in a simple loop 
                    # (In a production app, you'd use a task queue or separate thread)
                    monitor_otp(page, doc_ref.id, num_data['number'])
            
            time.sleep(60) # Check for new numbers every minute

if __name__ == "__main__":
    main()
