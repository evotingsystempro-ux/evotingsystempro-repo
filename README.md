# eVoting System Pro 🗳️

> Secure · Transparent · Precise

---

### Project Overview

**eVoting System Pro** is a digital voting platform built with **React Native (Expo)** and **Firebase**. It allows organizers to create and run secure, verifiable polls and elections — from single-choice leadership votes to multi-candidate committee elections — with real-time results and built-in fraud prevention.

---

## 🎯 Core Features

- 🔘 **Single-Choice Polls** — Voters select exactly one candidate. Ideal for elections, leadership votes, and referendums.
- ☑️ **Multiple-Choice Polls** — Voters select multiple candidates in one poll. Ideal for committee elections and ranked preference voting.
- 💳 **Pay-Per-Vote** — Charge a fee per vote, collected via Mobile Money, Card, or Crypto before a vote is cast.
- 📄 **Import Eligible Voters** — Upload a CSV, Excel, or text file of eligible voters so only registered participants can vote.
- ⏰ **Scheduled Voting Windows** — Set a precise start and end time; voting opens and closes automatically.
- 📊 **Real-Time Results** — Live charts and counters update instantly as votes are cast and verified.
- 🛡️ **Fraud Prevention & Security** — Device fingerprinting and server-side verification block duplicate votes, bots, and manipulation attempts.
- 👥 **Voter Management Dashboard** — Admins can view registered voters, track who has voted, and manage eligibility in real time.
- 🔔 **Push Notification Alerts** — Voters are notified when a poll opens, closes, or results are published.
- 📥 **Export Results** — Download final results as a PDF or Excel report for record-keeping, auditing, or public announcement.

---

## Key Tech Features

- ✅ Google Authentication (Sign-Up & Login)
- ✅ Firebase Authentication
- ✅ JWT-based token management (for native apps)
- ✅ Firebase Realtime Database for live presence & status tracking
- ✅ AI-powered Customer Support System
- ✅ Real-Time Chat System
- ✅ Real-time online/offline presence detection (`onDisconnect` / `onValue`)
- ✅ Push notifications via Expo Notifications
- ✅ Persistent local session caching with `AsyncStorage`
- ✅ Network status detection (online/offline handling)
- ✅ Cross-platform support (iOS, Android, Web) via Expo Router
- ✅ Session reset / clean logout flow with full storage cleanup
- ✅ OTA app updates via `expo-updates`

---

## Project Structure

```
CREATOR_DB
  └── creatorEmail@gmail.com
        ├── name
        ├── email
        ├── status: "active" | "inactive"
        ├── createdAt
        ├── dateCreated
        └── timeCreated

POLL_TITLE_DB
  └── creatorEmail@gmail.com
        └── polls (subcollection)
              └── POLL_1782_XK2A
                    ├── pollId
                    ├── title
                    ├── pollType: "single" | "multiple"
                    ├── isAnonymous: true | false
                    ├── showResults: true | false
                    ├── deadline: ISO string | null
                    ├── status: "active" | "closed"
                    ├── aspirantCount
                    ├── creatorEmail
                    ├── creatorName
                    ├── createdAt
                    ├── dateCreated
                    └── timeCreated

ASPIRANTS_DETAILS_DB
  └── creatorEmail@gmail.com
        └── POLL_1782_XK2A (subcollection)
              └── aspirant_id
                    ├── name
                    ├── email
                    ├── photo: url | ""
                    ├── votes: 0          // always write via increment()
                    ├── aspirantEmail@gmail.com
                    ├── creatorEmail
                    └── addedAt

VOTERS_DB
  └── voterEmail@gmail.com
        └── POLL_1782_XK2A
              ├── pollTitle
              ├── creatorEmail
              ├── aspirantVoted          // aspirantEmail@gmail.com
              └── votedAt
```

---

## ⚙️ Prerequisites

- A [Firebase](https://firebase.google.com/) project with **Authentication** and **Realtime Database** enabled
- [Expo CLI](https://docs.expo.dev/get-started/installation/) installed globally

---

## 🌍 Environment Setup

Create a `.env` file in the root directory with your Firebase project credentials.

> ⚠️ **Never commit your `.env` or `google-services.json` files.** Make sure both are listed in `.gitignore` before pushing to GitHub.

---

## ▶️ Get Started

1. **Install dependencies:**

   ```bash
   bun install
   ```

2. **Run the app:**

   ```bash
   npx expo start          # Start Expo dev server
   npx expo run:ios        # iOS Simulator
   npx expo run:android    # Android Emulator
   expo start --web        # Web browser
   ```

3. **Build for production:**

   ```bash
   eas build --platform ios --profile production
   eas build --platform android
   expo export --platform web -c   # Web export
   ```

---

## 🔗 Tech Stack

| Layer         | Technology                 |
| ------------- | -------------------------- |
| Framework     | Expo (React Native)        |
| Navigation    | Expo Router                |
| Database      | Firebase Realtime Database |
| Auth          | Firebase Authentication    |
| Notifications | Expo Push Notifications    |
| Local Storage | AsyncStorage               |

---

## 📚 Learn More

- [Expo Documentation](https://docs.expo.dev/)
- [Firebase Documentation](https://firebase.google.com/docs)

---

## 📄 License

Private & Proprietary — All rights reserved © eVoting System Pro
