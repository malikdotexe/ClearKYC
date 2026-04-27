# ClearKYC — Setup Guide

## Prerequisites
- Node.js 18+ installed
- A Google account
- A Razorpay account (free)

## 1. Firebase Setup (already done)

- Project: `clearkyc-d555b`
- Auth: Google Sign-In enabled
- Firestore: enabled

### Firestore Security Rules

Go to Firebase Console > Firestore > Rules, and paste:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

### Add your Vercel domain to Firebase Auth

After deploying to Vercel, go to:
Firebase Console > Authentication > Settings > Authorized domains

Add your `*.vercel.app` domain.

## 2. Google Cloud Vision API (already done)

- API Key created and restricted to Cloud Vision API

## 3. Razorpay (already done)

- Test mode keys created
- Test card for demos: `4111 1111 1111 1111`, any future expiry, any CVV

## 4. Local Development

```bash
npm install
npx vercel dev
```

## 5. Deployment

```bash
npx vercel --prod
```

## 6. Demo Flow

1. Open the deployed URL
2. Sign in with Google
3. Go to KYC Vault > Upload a PAN card image
4. Watch AI extract the PAN number, name, DOB
5. Upload Aadhaar card and selfie
6. Go to Bank View > Click a bank card
7. Complete payment with test card `4111 1111 1111 1111`
8. Check Access Log to see earnings

## Team

- MITU22BTCS0793 — Shreyash Yashwant Parve
- MITU22BTCS0713 — Sanchit Santos Aher
- MITU22BTCS0234 — Chirag Sharma
- MITU22BTCS0536 — Piyush Malik
- Guide: Prof. Rupesh Hushangabad
