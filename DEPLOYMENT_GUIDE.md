# PI Retrospective App — Deployment Guide

## Pre-Deployment Checklist

### 1. Code Review & Testing
- [ ] All console errors cleared (inspect dev tools)
- [ ] Test in fresh browser (no cache): `Ctrl+Shift+Delete` → clear cache → reload
- [ ] Test all phases: Setup → Participants → Context → Board → Actions → Analytics → Report → Export
- [ ] Test real-time sync: open 2 browser windows, add data in one, verify appears in other
- [ ] Test data persistence: add data, close tab, reopen, verify data still exists
- [ ] Test voting limit: add comment, vote once, try voting again (should fail)
- [ ] Test offline: open DevTools → Network → Offline, try to add data, verify localStorage fallback works
- [ ] Test participant login: create new session as host, add participant, login as participant, verify access

### 2. Firebase Production Setup
- [ ] Create production Firebase project (separate from dev)
- [ ] Enable Authentication: Anonymous (already required)
- [ ] Create Firestore database in production mode
- [ ] Update `js/firebase-config.js` with production credentials
- [ ] Set Firestore security rules (see section below)

### 3. Security Hardening
- [ ] Review Firestore security rules (currently test mode — ALLOW ALL)
- [ ] Remove test mode rules before going live
- [ ] Enable rate limiting on Firestore writes
- [ ] Set up CORS headers on hosting domain
- [ ] Enable HTTPS (all hosting options provide this)

---

## Firebase Production Configuration

### Step 1: Create Production Firebase Project
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click **+ Add project**
3. Name: `pi-retrospective-prod`
4. Disable Google Analytics (or enable if you want usage tracking)
5. Create project

### Step 2: Add Web App
1. In Firebase project, click **</>** (Web icon)
2. App name: `PI Retrospective Web`
3. Uncheck "Also set up Firebase Hosting for this project" (deploy separately)
4. Copy the config object
5. Update `js/firebase-config.js`:

```javascript
const firebaseConfig = {
  apiKey: "YOUR_PRODUCTION_API_KEY",
  authDomain: "your-project.firebaseapp.com",
  projectId: "pi-retrospective-prod",
  storageBucket: "pi-retrospective-prod.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```

### Step 3: Enable Firestore
1. Firebase Console → **Firestore Database**
2. Click **Create database**
3. Start in **production mode** (NOT test mode)
4. Select region closest to users (default: `us-central1`)
5. Click **Create**

### Step 4: Set Security Rules
1. Go to Firestore → **Rules** tab
2. Replace with:

```firestore
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // Active retrospective — anyone can read/write
    // In production, restrict to authenticated users
    match /retrospectives/pi-retro-active {
      allow read, write: if request.auth != null;
    }
    
    // History retrospectives — users can read/write their own
    match /history/{retroId} {
      allow read, write: if request.auth != null;
    }
    
    // Deny all other access
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

3. Click **Publish**

### Step 5: Enable Anonymous Authentication (if not already enabled)
1. Firebase Console → **Authentication**
2. Click **Sign-in method** tab
3. Enable **Anonymous**
4. Click **Save**

---

## Hosting Options

### Option A: Firebase Hosting (Recommended — Free Tier)
**Best for:** Quick, integrated solution with auto-scaling

#### Deploy Steps:
1. Install Firebase CLI:
```bash
npm install -g firebase-tools
```

2. Initialize Firebase in project root:
```bash
firebase login
firebase init hosting
```

3. When prompted:
   - Select your production Firebase project
   - Public directory: `.` (current directory)
   - Rewrite all URLs to index.html: **Yes**
   - Set up automatic builds with GitHub: **No** (do manual)
   - File index.html already exists: **Yes, overwrite**

4. Deploy:
```bash
firebase deploy --only hosting
```

5. Your app is live at: `https://YOUR_PROJECT.web.app`

**Cost:** Free tier includes 10GB/month storage + 1GB/month transfer

---

### Option B: Netlify (Recommended — Best for Custom Domains)
**Best for:** Free SSL, custom domains, preview deployments

#### Deploy Steps:
1. Create `netlify.toml` in project root:
```toml
[build]
  command = "echo 'No build needed'"
  publish = "."

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

2. Push to GitHub:
```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/pi-retrospective.git
git push -u origin main
```

3. Go to [Netlify](https://app.netlify.com/)
4. Click **New site from Git**
5. Connect GitHub repo
6. Build settings:
   - Build command: (leave empty)
   - Publish directory: `.`
7. Click **Deploy**

**Domain:** `your-site.netlify.app` → Custom domain available in Site settings

**Cost:** Free tier sufficient for this app

---

### Option C: Vercel (Alternative)
**Best for:** Fast global CDN, serverless functions (for future API)

#### Deploy Steps:
```bash
npm install -g vercel
vercel --prod
```

**Cost:** Free tier sufficient

---

## Pre-Deployment Testing (Production Environment)

### Test in Production Firebase (Before Going Live)

1. **Test data save:**
   - Open app
   - Create new retrospective
   - Add event to PI Context
   - Refresh page → data persists ✓

2. **Test real-time sync:**
   - Open 2 browser tabs with same session
   - Add event in tab 1
   - Verify appears in tab 2 within 2 seconds ✓

3. **Test offline mode:**
   - DevTools → Network → Offline
   - Try to add data
   - DevTools → Network → Online
   - Data syncs to Firestore ✓

4. **Load test (optional):**
   - Open 5+ browser tabs
   - Add data simultaneously
   - Verify no data loss ✓

---

## Deployment Checklist

### Before Clicking "Deploy"

- [ ] `js/firebase-config.js` updated with PRODUCTION credentials
- [ ] Firestore security rules are NOT in test mode
- [ ] Tested all data operations in production Firebase
- [ ] Tested offline fallback
- [ ] Tested real-time sync
- [ ] No console errors on fresh page load
- [ ] All CSS and JavaScript files load (no 404 errors)
- [ ] Images load correctly
- [ ] Responsive design works on mobile (DevTools → Mobile view)

### During Deployment

- [ ] Deploy to staging first (if available on platform)
- [ ] Verify deployed app loads: https://your-domain/
- [ ] Test same flows as pre-deployment checklist
- [ ] Monitor browser console for errors
- [ ] Check Firestore quota usage (Firebase Console)

### After Deployment

- [ ] Share live URL with team
- [ ] Monitor Firestore usage for 24 hours
- [ ] Collect user feedback
- [ ] Keep backups of production database

---

## Production Security Best Practices

### 1. Firestore Security Rules
✅ Limit reads/writes to authenticated users
✅ Implement data validation in rules
✅ Add rate limiting

❌ Don't use test mode in production
❌ Don't expose API keys in frontend (use restriction)

### 2. Firebase API Key Restriction
1. Firebase Console → **Project Settings**
2. Click **Service Accounts** tab
3. API Keys section → Edit key
4. Add Application restrictions: **HTTP referrers**
5. Add your domain: `your-domain.com/*`

### 3. HTTPS & SSL
✅ All hosting options provide free HTTPS
✅ Firestore only accepts secure connections

### 4. Environment Variables (Optional)
If deploying to multiple environments:

```javascript
// js/firebase-config.js
const ENV = window.location.hostname.includes('staging') ? 'staging' : 'prod';

const firebaseConfig = ENV === 'prod'
  ? { /* production config */ }
  : { /* staging config */ };
```

---

## Troubleshooting Deployment

### Issue: "Cannot GET /" after deployment
**Solution:** Configure hosting to redirect all URLs to index.html
- Firebase Hosting: `firebase init` sets this up automatically
- Netlify: Add `netlify.toml` redirects rule (see above)
- Vercel: Create `vercel.json` with rewrites

### Issue: Data not saving
**Solution:** Check Firestore security rules
- Firebase Console → Firestore → **Rules** tab
- Verify rules allow your authenticated user
- Check browser console for error messages

### Issue: Real-time sync not working
**Solution:** Check Firestore connection
- Open DevTools → Network tab
- Look for requests to `firestore.googleapis.com`
- If blocked: disable ad blocker, check firewall

### Issue: "Firebase not initialized"
**Solution:** Verify firebase-config.js loaded
- Check Network tab → look for `firebase-config.js`
- Ensure config is before `app.js` loads in HTML
- Verify no syntax errors in config file

---

## Monitoring Post-Deployment

### Firebase Console Metrics
1. **Firestore Usage:**
   - Realtime Database → Usage tab
   - Monitor Reads, Writes, Deletes
   - Set budget alerts at $10-20/month

2. **Authentication:**
   - Authentication → Users tab
   - Monitor anonymous user creation

3. **Performance:**
   - Performance Monitoring → Dashboard
   - Track page load times, Firebase latency

### Browser Console Monitoring
Keep browser open periodically to check:
- No red error messages
- No warnings about blocked resources
- Firestore connection established (Network tab)

---

## Rollback Plan

If production deployment has issues:

### Firebase Hosting
```bash
# List previous versions
firebase hosting:channel:list

# Rollback to previous version
firebase hosting:channel:deploy main --expires=1h
```

### Netlify
1. Netlify Dashboard → **Deploys**
2. Find previous successful deploy
3. Click **Restore**

### Vercel
1. Vercel Dashboard → **Deployments**
2. Find previous successful deployment
3. Click **Promote to Production**

---

## Post-Launch Checklist

**Week 1:**
- [ ] Monitor Firestore quota daily
- [ ] Collect user feedback on performance
- [ ] Watch browser console for unexpected errors
- [ ] Verify data persists across sessions

**Month 1:**
- [ ] Review analytics (if enabled)
- [ ] Optimize any slow operations
- [ ] Plan Phase 2 features (authentication, permissions)

---

## Next Steps (Future Enhancements)

1. **Production Authentication:**
   - Replace anonymous auth with Google/Office 365
   - Add email-based login
   - Implement team permissions

2. **Data Backup:**
   - Set up automatic Firestore backups
   - Implement export-to-CSV feature

3. **Advanced Features:**
   - Real-time cursors (who's editing)
   - Comment threads on board items
   - Mobile app (React Native/Flutter)

---

## Support & Documentation

- **Firebase Docs:** https://firebase.google.com/docs
- **Firestore Security Rules:** https://firebase.google.com/docs/firestore/security/start
- **Firebase Hosting:** https://firebase.google.com/docs/hosting
- **Netlify Docs:** https://docs.netlify.com

---

**Deployment estimated time:** 15-20 minutes
**Go live checklist:** ✅ All sections complete
