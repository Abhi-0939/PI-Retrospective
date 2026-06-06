# Firebase Real-Time Sync Setup Guide

## ✅ Quick Start (5 minutes)

### Step 1: Create Firebase Project
1. Go to [https://console.firebase.google.com](https://console.firebase.google.com)
2. Click **"Create Project"** (or select existing project)
3. Name it **"PI-Retrospective"**
4. Choose region closest to you
5. Enable Google Analytics (optional)
6. Wait for project to initialize

### Step 2: Get Firebase Configuration
1. In Firebase Console, click ⚙️ **Settings** (top-left)
2. Go to **"Project settings"** tab
3. Scroll down to **"Your apps"** section
4. Click the **Web** icon (`</>`)
5. Register app as **"PI Retrospective"**
6. Copy the entire `firebaseConfig` object (it looks like this):

```javascript
{
  apiKey: "AIzaSyD...",
  authDomain: "pi-retrospective-xyz.firebaseapp.com",
  projectId: "pi-retrospective-xyz",
  storageBucket: "pi-retrospective-xyz.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef..."
}
```

### Step 3: Update firebase-config.js
1. Open `js/firebase-config.js` in your editor
2. Replace the placeholder `firebaseConfig` with your actual credentials
3. Example:
```javascript
const firebaseConfig = {
  apiKey: "AIzaSyD...",
  authDomain: "pi-retrospective-xyz.firebaseapp.com",
  projectId: "pi-retrospective-xyz",
  storageBucket: "pi-retrospective-xyz.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef..."
};

export default firebaseConfig;
```
4. **Save the file**

### Step 4: Create Firestore Database
1. In Firebase Console, go to **Firestore Database** (left sidebar)
2. Click **"Create Database"**
3. **Start in test mode** (for development)
4. Choose region closest to you
5. Click **"Enable"**

### Step 5: Set Firestore Security Rules
1. In Firestore, go to the **"Rules"** tab
2. Replace the entire rule set with:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /retrospectives/{docId} {
      allow read, write: if true;
    }
    match /retrospectives/{docId}/history/{historyId} {
      allow read, write: if true;
    }
  }
}
```

3. Click **"Publish"**

⚠️ **Important:** These are **open rules for testing only**. Before deploying to production, implement proper authentication.

### Step 6: Deploy Website
Choose one of the following:

#### Option A: GitHub Pages (FREE)
1. Push code to GitHub repo
2. Go to repo **Settings** → **Pages**
3. Source: Deploy from branch
4. Select `main` branch, `/ (root)` folder
5. Your site is live at `https://username.github.io/repo-name`

#### Option B: Netlify (FREE)
1. Push code to GitHub
2. Go to [https://netlify.com](https://netlify.com)
3. Click **"Connect to Git"**
4. Authorize GitHub
5. Select your repo
6. Deploy settings (defaults are fine)
7. Click **"Deploy"**
8. Site is live in ~1 minute

#### Option C: Vercel (FREE)
1. Push code to GitHub
2. Go to [https://vercel.com](https://vercel.com)
3. Import your repo
4. Deploy
5. Site is live

---

## 📊 How Real-Time Sync Works

### Before (localStorage only)
- Each browser stores data separately
- Changes don't sync across devices/tabs
- Multiple users see their own copies
- **No collaboration**

### After (Firebase + localStorage fallback)
- **Active retrospective** saved to Firestore `retrospectives/pi-retro-active`
- **History** saved to Firestore subcollection `retrospectives/history/{id}`
- Auto-save every 30 seconds
- If Firebase is down, falls back to localStorage
- All data stays encrypted in transit (HTTPS)
- **Participants can see updates in real-time** (new notes, votes, action items)

### Data Structure in Firestore
```
retrospectives/
├── pi-retro-active (document)
│   ├── piName: "PI-24"
│   ├── participants: [...]
│   ├── board: { wentWell: [...], couldImprove: [...], ... }
│   ├── actionItems: [...]
│   └── updatedAt: "2026-06-06T..."
│
└── history (subcollection)
    ├── {retrospective-id-1}
    ├── {retrospective-id-2}
    └── ...
```

---

## 🔒 Security Considerations

### Current Setup (Development Only)
- Firestore allows **any read/write** without authentication
- OK for **internal team use** within trusted network
- Not OK for **public internet**

### Before Going to Production
Implement proper authentication:

1. **Enable Firebase Authentication**
   - Go to Authentication → Sign-in method
   - Enable "Email/Password" or "Google" or "Microsoft"

2. **Update Firestore Rules** to require authentication:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /retrospectives/{docId} {
      allow read, write: if request.auth != null;
    }
    match /retrospectives/{docId}/history/{historyId} {
      allow read, write: if request.auth != null;
    }
  }
}
```

3. **Update app.js** to add login:
   - Integrate Firebase Auth
   - Require users to sign in before accessing retros
   - (Contact AWS/Azure team if using SSO)

---

## ✅ Testing

1. Open the deployed site in **two different browsers** (or incognito windows)
2. **Browser 1:** Create new retrospective, add some notes
3. **Browser 2:** Open the same retrospective
4. **Browser 1:** Add more notes → should appear in Browser 2 within 1 second
5. **Browser 1:** Vote on a note → vote count updates in Browser 2

If real-time updates don't appear:
- Check Firebase Console → Firestore → Data
- Verify security rules are published (not in **Draft**)
- Check browser console for errors (F12 → Console tab)

---

## 🆘 Troubleshooting

### "Firebase not initialized" error
- Check `firebase-config.js` has all required fields
- Verify no typos in apiKey, projectId, etc.
- Reload page and check browser console (F12)

### "Permission denied" when saving
- Firestore rules are in "Draft" mode (publish them!)
- Or rules require authentication but no user is logged in
- Check Firestore Rules tab → click "Publish"

### Real-time updates not working
- Open Firestore Console → Firestore → Rules tab → is it published?
- Check browser console for errors
- Verify both browsers are accessing the **same** retrospective ID
- Slow connection? Updates may take 1-3 seconds

### Data not persisting between refreshes
- Is Firestore showing the data in the "Data" tab?
- Browser storage quota exceeded? (unlikely, but check Developer Tools)
- Try clearing browser cache and localStorage

---

## 📞 Support

If you hit issues:

1. **Check Firebase Console** → Firestore → Data tab (is data being stored?)
2. **Check browser console** (F12) for JavaScript errors
3. **Verify firebaseConfig** in `js/firebase-config.js`
4. **Test in incognito window** (rules out browser cache)
5. **Check Firestore Rules** are published (not Draft)

---

## 📈 Scaling

**Current free tier limits (per month):**
- 50,000 document reads
- 20,000 document writes
- ~30 active users simultaneously

For < 20 person team: **plenty of room**

If you grow beyond this, upgrade to Firebase Blaze (pay-as-you-go).

---

**That's it! 🚀 Your PI Retrospective app now syncs in real-time.**
