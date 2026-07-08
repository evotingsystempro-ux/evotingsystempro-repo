import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs } from "firebase/firestore";
import { getDatabase } from "firebase/database";
import { getFunctions } from "firebase/functions";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";
import {
  initializeAuth,
  getAuth,
  getReactNativePersistence,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  sendEmailVerification,
  sendSignInLinkToEmail,
  confirmPasswordReset,
  signInWithPhoneNumber,
  validatePassword,
  updateProfile,
  GoogleAuthProvider,
  signInWithCredential,
  type Auth,
} from "firebase/auth";
import { type Firestore } from "firebase/firestore";
import { type Database } from "firebase/database";
import { type FirebaseStorage } from "firebase/storage";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID,
};


let auth: Auth;
let db: Firestore;
let rtdb: Database;
let functions: ReturnType<typeof getFunctions>;
let storage: FirebaseStorage;                    // ← typed instance, not the function

try {
  const app = initializeApp(firebaseConfig);

  db = getFirestore(app);
  rtdb = getDatabase(app);
  functions = getFunctions(app);
  storage = getStorage(app);                   // ← instantiated here alongside db

  if (Platform.OS === "web") {
    auth = getAuth(app);
  } else {
    auth = initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  }
} catch (error) {
  console.error("Firebase init error:", error);
}

export {
  // Auth
  auth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  sendEmailVerification,
  sendSignInLinkToEmail,
  confirmPasswordReset,
  signInWithPhoneNumber,
  validatePassword,
  updateProfile,
  GoogleAuthProvider,
  signInWithCredential,

  // Firestore
  db,
  collection,
  getDocs,

  // Realtime DB
  rtdb,

  // Cloud Functions
  functions,

  // Storage — export the instance, not the raw functions
  storage,
  ref,
  uploadBytes,
  getDownloadURL,
};
