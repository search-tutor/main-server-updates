# 🔥 Quick Firebase Setup - 5 Minutes

## Step 1: Get Firebase Service Account Key

1. **Go to Firebase Console:**
   - Open: https://console.firebase.google.com/
   - Login with your Google account

2. **Select Your Project:**
   - Click on: `search-tutor-81f2b`

3. **Go to Service Accounts:**
   - Click: ⚙️ (Settings icon) → Project settings
   - Click: "Service accounts" tab
   - You'll see: "Firebase Admin SDK" section

4. **Generate Key:**
   - Click: "Generate new private key" button
   - Confirm: "Generate key"
   - A JSON file will download (e.g., `search-tutor-81f2b-firebase-adminsdk-xxxxx.json`)

## Step 2: Format the JSON

Open the downloaded JSON file. It looks like this:

```json
{
  "type": "service_account",
  "project_id": "search-tutor-81f2b",
  "private_key_id": "abc123...",
  "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANB...\n-----END PRIVATE KEY-----\n",
  "client_email": "firebase-adminsdk-xxxxx@search-tutor-81f2b.iam.gserviceaccount.com",
  "client_id": "123456789...",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk..."
}
```

**Convert to single line:**
- Remove all line breaks
- Keep it as valid JSON
- Example: `{"type":"service_account","project_id":"search-tutor-81f2b",...}`

**Easiest way:**
1. Copy entire JSON content
2. Go to: https://jsonformatter.org/json-minify
3. Paste JSON → Click "Minify"
4. Copy the minified result

## Step 3: Add to .env

Open: `Search-Tutor-seraver-redesign/.env`

Add this line (paste your minified JSON):

```env
FIREBASE_SERVICE_ACCOUNT={"type":"service_account","project_id":"search-tutor-81f2b",...paste entire minified JSON here...}
```

**Important:**
- No spaces around `=`
- Entire JSON on one line
- Keep quotes intact

## Step 4: Restart Server

```bash
# Stop current server (Ctrl+C)
# Then restart:
npm run dev
```

**You should see:**
```
✅ Firebase Admin initialized successfully
search teacher is sitting on port 4000
```

## Step 5: Test Push Notification

1. **Login as Tutor** (in browser)
   - Accept notification permission
   - Check console: `✅ FCM token saved to backend`

2. **Post a Job** (as Admin)
   - Use same city as tutor
   - Submit job

3. **Check Backend Logs:**
   ```
   📤 Sending notifications to X tutors in Dhaka
   ✅ Notifications sent: X success, 0 failed
   ```

4. **Tutor Should Receive:**
   - Browser notification: "🎓 New Job in Dhaka!"
   - Click → Opens job details

---

## 🐛 Troubleshooting:

### ❌ Still showing "⚠️ Firebase Admin not initialized"

**Solution 1:** Check .env format
```env
# WRONG ❌
FIREBASE_SERVICE_ACCOUNT = { "type": ...}

# RIGHT ✅
FIREBASE_SERVICE_ACCOUNT={"type":...}
```

**Solution 2:** Make sure JSON is valid
- Test your JSON: https://jsonlint.com/
- Should show "Valid JSON"

**Solution 3:** Check file location
- `.env` should be in: `Search-Tutor-seraver-redesign/.env`
- Not in parent folder

### ❌ Notification not appearing in browser

**Check:**
1. Browser notification permission granted?
2. FCM token saved to database? (check MongoDB)
3. City matches between tutor and job?
4. Backend logs showing "✅ Notifications sent"?

---

## ✅ Success Checklist:

- [ ] Downloaded Firebase service account JSON
- [ ] Minified JSON to single line
- [ ] Added to .env file as FIREBASE_SERVICE_ACCOUNT
- [ ] Restarted backend server
- [ ] Seeing "✅ Firebase Admin initialized successfully"
- [ ] Tutor logged in and granted notification permission
- [ ] FCM token saved (check backend logs)
- [ ] Posted a job with matching city
- [ ] Backend logs show "✅ Notifications sent: X success"
- [ ] Browser notification received

---

**Need help?** Check the backend terminal for detailed error messages.
