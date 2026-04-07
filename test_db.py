import firebase_admin
from firebase_admin import credentials
from google.cloud import firestore
import os
import json

PROJECT_ID = "gen-lang-client-0472035720"
DATABASE_ID = "ai-studio-edf518e7-ccd7-4d8a-afd7-3f1030781b80"

try:
    if os.environ.get('FIREBASE_SERVICE_ACCOUNT'):
        service_account_info = json.loads(os.environ.get('FIREBASE_SERVICE_ACCOUNT'))
        cred = credentials.Certificate(service_account_info)
        firebase_admin.initialize_app(cred, {'projectId': PROJECT_ID})
        db = firestore.Client(project=PROJECT_ID, database=DATABASE_ID)
        print("Firestore Connection SUCCESS")
    else:
        print("FIREBASE_SERVICE_ACCOUNT not found in environment")
except Exception as e:
    print(f"Firestore Connection FAILED: {e}")
