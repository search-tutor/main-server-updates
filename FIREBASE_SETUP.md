# Firebase Admin SDK Setup Instructions

## 🔥 Firebase Service Account Key Setup

To enable push notifications, you need to add your Firebase Admin SDK service account key to the `.env` file.

### Steps:

1. **Go to Firebase Console:**
   - Visit: https://console.firebase.google.com/
   - Select your project: `search-tutor-81f2b`

2. **Generate Service Account Key:**
   - Go to: Project Settings (⚙️) → Service Accounts
   - Click: "Generate New Private Key"
   - A JSON file will download

3. **Add to .env file:**
   - Open the downloaded JSON file
   - Copy the entire JSON content
   - In your `.env` file, add:

```env
FIREBASE_SERVICE_ACCOUNT={"type":"service_account","project_id":"search-tutor-81f2b",...}
```

**Important:** 
- The JSON should be on a single line
- Remove all line breaks from the JSON
- Keep it as a valid JSON string

### Example .env structure:

```env
URI=mongodb+srv://...
JWT_SECRET=your_secret
JWT_EXPIRES_IN=7d
PORT=4000
FIREBASE_SERVICE_ACCOUNT={"type":"service_account","project_id":"search-tutor-81f2b","private_key_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n","client_email":"...","client_id":"...","auth_uri":"https://accounts.google.com/o/oauth2/auth","token_uri":"https://oauth2.googleapis.com/token","auth_provider_x509_cert_url":"https://www.googleapis.com/oauth2/v1/certs","client_x509_cert_url":"..."}
```

### Test:
After adding the key, restart the server:
```bash
npm run dev
```

You should see:
```
✅ Firebase Admin initialized successfully
```

If you see:
```
⚠️ Firebase Admin not initialized - service account not found
```

Then the FIREBASE_SERVICE_ACCOUNT is missing or invalid in your .env file.

---

## 📝 Notes:
- Never commit the service account key to Git
- Add `.env` to `.gitignore`
- Keep the private key secure
