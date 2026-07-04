// MembersList.tsx
import React, {
  useState,
  useRef,
  useEffect,
  useContext,
  useMemo,
  useCallback,
} from "react";
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  TextInput,
  Platform,
  ActivityIndicator,
} from "react-native";
import { FlashList } from "@shopify/flash-list";
import { router, useFocusEffect } from "expo-router";
import * as Updates from "expo-updates";
import {
  serverTimestamp,
  setDoc,
  getDoc,
  doc,
  onSnapshot,
  updateDoc,
  arrayUnion,
} from "firebase/firestore";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { auth, createUserWithEmailAndPassword, db } from "@/firebase";
import { useAuth } from "@/context/auth";
import { GlobalContext } from "@/context/index";
import BottomNav from "@/components/BottomNav";
import ReusableScreen from "@/components/ReusableScreen";
import PopupMenu from "@/components/PupupMenu";
import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { timeAgo } from "@/hooks/timeAgo";
import { useMembersListener } from "@/hooks/useMembersListener";
import { getDeviceId } from "@/hooks/device_uuid";
import { useLogout } from "@/hooks/useLogout";
import AnnouncementModalComponentAppUpdate from "@/components/AnnouncementModalComponentAppUpdate";
import ChatBanner from "@/components/ChatBanner";
import * as Device from "expo-device";
import * as Application from "expo-application";
import { MenuProvider } from "react-native-popup-menu";
import { useChatListListener } from "@/hooks/useChatListListener";

// ─── Constants ────────────────────────────────────────────────────────────────

const FP_CACHE_KEY = "device_fp_cache";
const FP_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEVICE_VERIFIED_KEY = "device_verified_session";
const STORAGE_KEY = "APP_DEVICE_UUID";
const COOKIE_KEY = "app_device_uuid";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 3650;
const HYBRID_FP_COLLECTION = "Hybridfingerprint_DB";
const MAX_ACCOUNT_RELINKS = 3; // number of times a device's linked account may be corrected/switched
const PAGE_SIZE = 15;
const ITEM_HEIGHT = 66;
const PUSH_NOTIFICATION_URL =
  "https://email-service-1054780588098.us-central1.run.app/push_notification";

const ADMIN_EMAILS: ReadonlySet<string> = new Set([
  "deborah0marie@gmail.com",
  "morinchris453@gmail.com",
  "stanleyafon@gmail.com",
  "litmusberk@gmail.com",
  "karisafon9@gmail.com",
  "juankirch931@gmail.com",
  "matildaafon@gmail.com",
  "stanleyafon6@gmail.com",
  "julietkpeku@gmail.com",
  "smartlearnerstech@gmail.com",
  "evotingsystempro@gmail.com",
  "evotingpro@gmail.com",
  "gordonlydia026@gmail.com",
]);

// ─── Types ────────────────────────────────────────────────────────────────────

interface FpCacheEntry {
  fingerprintHash: string;
  email: string;
  source: string;
  verifiedAt: number;
}

interface MemberItem {
  clientId: string;
  clientName: string;
  email: string;
  phone?: string;
  iconUrl: string | { letter: string; color: string; type?: string };
  createdAt?: { seconds: number };
  [key: string]: unknown;
}

// `allowed: true` covers both a first-time link and a fresh relink.
// `relinked: true` additionally tells the caller a switch just happened,
// in case the UI wants to surface a "device re-linked to new account" notice.
type FpGateResult =
  | { allowed: true; relinked?: boolean; relinksRemaining?: number }
  | { allowed: false; linkedEmail: string };

// ─── Crypto / Fingerprint helpers ─────────────────────────────────────────────

async function sha256(str: string): Promise<string> {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const buffer = new TextEncoder().encode(str);
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  try {
    const ExpoCrypto = require("expo-crypto");
    return await ExpoCrypto.digestStringAsync(
      ExpoCrypto.CryptoDigestAlgorithm.SHA256,
      str
    );
  } catch {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (Math.imul(31, hash) + str.charCodeAt(i)) | 0;
    }
    return Math.abs(hash).toString(16).padStart(8, "0");
  }
}

async function getCanvasFingerprint(): Promise<string> {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 200;
    canvas.height = 50;
    const ctx = canvas.getContext("2d")!;
    ctx.textBaseline = "top";
    ctx.font = "14px Arial";
    ctx.fillStyle = "#f60";
    ctx.fillRect(125, 1, 62, 20);
    ctx.fillStyle = "#069";
    ctx.fillText("BrowserFingerprint", 2, 15);
    ctx.fillStyle = "rgba(102,204,0,0.7)";
    ctx.fillText("BrowserFingerprint", 4, 17);
    return canvas.toDataURL();
  } catch {
    return "canvas-blocked";
  }
}

async function getWebGLFingerprint(): Promise<string> {
  try {
    const canvas = document.createElement("canvas");
    const gl = (
      canvas.getContext("webgl") || canvas.getContext("experimental-webgl")
    ) as WebGLRenderingContext | null;
    if (!gl) return "webgl-unavailable";
    const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
    const vendor = debugInfo
      ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL)
      : gl.getParameter(gl.VENDOR);
    const renderer = debugInfo
      ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER);
    return `${vendor}~${renderer}`;
  } catch {
    return "webgl-blocked";
  }
}

async function getAudioFingerprint(): Promise<string> {
  try {
    const AudioCtx: typeof AudioContext =
      (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return "audio-unavailable";
    const ctx = new AudioCtx();
    const oscillator = ctx.createOscillator();
    const analyser = ctx.createAnalyser();
    const gain = ctx.createGain();
    const scriptProcessor = ctx.createScriptProcessor(4096, 1, 1);
    gain.gain.value = 0;
    oscillator.type = "triangle";
    oscillator.connect(analyser);
    analyser.connect(scriptProcessor);
    scriptProcessor.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(0);
    return new Promise((resolve) => {
      scriptProcessor.onaudioprocess = (event) => {
        const output = event.inputBuffer.getChannelData(0);
        let sum = 0;
        for (let i = 0; i < output.length; i++) sum += Math.abs(output[i]);
        oscillator.disconnect();
        analyser.disconnect();
        scriptProcessor.disconnect();
        gain.disconnect();
        ctx.close();
        resolve(sum.toString());
      };
    });
  } catch {
    return "audio-blocked";
  }
}

function getStableSystemSignals(): string {
  const nav = navigator;
  return [
    nav.hardwareConcurrency || "unknown",
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    new Date().getTimezoneOffset(),
    nav.language || "unknown",
    (nav.languages || []).join(","),
    nav.platform || "unknown",
  ].join("|");
}

async function getWebFingerprint(): Promise<{ hash: string; source: string }> {
  const [canvas, webgl, audio] = await Promise.all([
    getCanvasFingerprint(),
    getWebGLFingerprint(),
    getAudioFingerprint(),
  ]);
  const system = getStableSystemSignals();
  const raw = [canvas, webgl, audio, system].join("||");
  const hash = await sha256(raw);
  return { hash, source: "web" };
}

async function getDeviceFingerprint(): Promise<{ hash: string; source: string }> {
  if (Platform.OS === "android") {
    const id = await Application.getAndroidId();
    if (id) return { hash: `android_${id}`, source: "android" };
  }
  if (Platform.OS === "ios") {
    const id = await Application.getIosIdForVendorAsync();
    if (id) return { hash: `ios_${id}`, source: "ios" };
  }
  if (Platform.OS === "web" || typeof document !== "undefined") {
    return getWebFingerprint();
  }
  throw new Error(`Unsupported platform: ${Platform.OS}`);
}

// ─── Cookie helpers (web only) ────────────────────────────────────────────────

const getCookie = (name: string): string | null => {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.split("=")[1]) : null;
};

const setCookie = (name: string, value: string): void => {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=${encodeURIComponent(value)}; max-age=${COOKIE_MAX_AGE}; path=/; SameSite=Strict`;
};

const generateUUID = (): string =>
  "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });

export const getStableDeviceId = async (): Promise<string> => {
  try {
    if (Platform.OS === "android") {
      const id = await Application.getAndroidId();
      if (id) return `android_${id}`;
    }
    if (Platform.OS === "ios") {
      const id = await Application.getIosIdForVendorAsync();
      if (id) return `ios_${id}`;
    }
    if (Platform.OS === "web") {
      const fromCookie = getCookie(COOKIE_KEY);
      if (fromCookie) {
        try { localStorage.setItem(STORAGE_KEY, fromCookie); } catch (_) { }
        return `web_${fromCookie}`;
      }
      let fromStorage: string | null = null;
      try { fromStorage = localStorage.getItem(STORAGE_KEY); } catch (_) { }
      if (fromStorage) {
        setCookie(COOKIE_KEY, fromStorage);
        return `web_${fromStorage}`;
      }
      const uuid = generateUUID();
      setCookie(COOKIE_KEY, uuid);
      try { localStorage.setItem(STORAGE_KEY, uuid); } catch (_) { }
      return `web_${uuid}`;
    }
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (stored) return `fallback_${stored}`;
    const uuid = generateUUID();
    await AsyncStorage.setItem(STORAGE_KEY, uuid);
    return `fallback_${uuid}`;
  } catch (err) {
    console.warn("getStableDeviceId error:", err);
    return "error_unknown_device";
  }
};

// ─── AsyncStorage cache helpers ───────────────────────────────────────────────

async function writeFpCache(entry: Omit<FpCacheEntry, "verifiedAt">): Promise<void> {
  try {
    const payload: FpCacheEntry = { ...entry, verifiedAt: Date.now() };
    await AsyncStorage.setItem(FP_CACHE_KEY, JSON.stringify(payload));
  } catch (err) {
    console.warn("writeFpCache failed:", err);
  }
}

async function readFpCache(): Promise<FpCacheEntry | null> {
  try {
    const raw = await AsyncStorage.getItem(FP_CACHE_KEY);
    return raw ? (JSON.parse(raw) as FpCacheEntry) : null;
  } catch {
    return null;
  }
}

async function clearFpCache(): Promise<void> {
  try {
    await AsyncStorage.removeItem(FP_CACHE_KEY);
  } catch { }
}

// ─── Fingerprint gate ─────────────────────────────────────────────────────────
//
// Policy: exactly ONE account may be actively linked to a device at a time
// (so a device can never be used to double-vote or double-farm wallet credit
// simultaneously across accounts). However, a user is allowed up to
// MAX_ACCOUNT_RELINKS (3) *corrections* — e.g. they logged into the wrong
// account by mistake and want to switch to the right one. Each correction
// consumes one relink. Once the limit is hit, the device is locked to
// whichever email is currently linked.

async function checkHybridFingerprintGate(
  fingerprintHash: string,
  email: string,
  source: string
): Promise<FpGateResult> {
  try {
    const normalizedEmail = email.trim().toLowerCase();
    const docRef = doc(db, HYBRID_FP_COLLECTION, fingerprintHash);
    const snap = await getDoc(docRef);

    if (!snap.exists()) {
      await setDoc(docRef, {
        fingerprintHash,
        email: normalizedEmail,
        source,
        platform: Platform.OS,
        deviceModel: Device.modelName ?? "unknown",
        deviceBrand: Device.brand ?? "unknown",
        osVersion: Device.osVersion ?? "unknown",
        relinkCount: 0,
        previousEmails: [],
        createdAt: serverTimestamp(),
        lastSeen: serverTimestamp(),
      });
      await writeFpCache({ fingerprintHash, email: normalizedEmail, source });
      return { allowed: true, relinksRemaining: MAX_ACCOUNT_RELINKS };
    }

    const data = snap.data() as any;
    const linkedEmail: string = data.email;
    const relinkCount: number = data.relinkCount ?? 0;

    if (linkedEmail === normalizedEmail) {
      updateDoc(docRef, { lastSeen: serverTimestamp() }).catch((err) =>
        console.warn("lastSeen update failed:", err)
      );
      await writeFpCache({ fingerprintHash, email: normalizedEmail, source });
      return { allowed: true, relinksRemaining: MAX_ACCOUNT_RELINKS - relinkCount };
    }

    // Different account trying to use this device.
    if (relinkCount < MAX_ACCOUNT_RELINKS) {
      await updateDoc(docRef, {
        email: normalizedEmail,
        relinkCount: relinkCount + 1,
        previousEmails: arrayUnion(linkedEmail),
        lastRelinkAt: serverTimestamp(),
        lastSeen: serverTimestamp(),
      });

      // Revoke the previously-linked account's active session on this device
      // so the old and new accounts can't both stay "active" at once.
      try {
        await setDoc(
          doc(db, "user_sessions", linkedEmail),
          { activeDeviceId: null, revokedAt: serverTimestamp(), revokedReason: "device_relinked" },
          { merge: true }
        );
      } catch (err) {
        console.warn("Failed to revoke previous account session on relink:", err);
      }

      await writeFpCache({ fingerprintHash, email: normalizedEmail, source });
      return {
        allowed: true,
        relinked: true,
        relinksRemaining: MAX_ACCOUNT_RELINKS - (relinkCount + 1),
      };
    }

    return { allowed: false, linkedEmail };
  } catch (err) {
    console.warn("HybridFingerprint gate error (failing open):", err);
    return { allowed: true };
  }
}

async function runFingerprintGateWithCache(email: string): Promise<FpGateResult> {
  const normalizedEmail = email.trim().toLowerCase();
  const cached = await readFpCache();
  const cacheValid =
    cached !== null &&
    cached.email === normalizedEmail &&
    Date.now() - cached.verifiedAt < FP_CACHE_TTL_MS;

  if (cacheValid && cached) {
    try {
      const docRef = doc(db, HYBRID_FP_COLLECTION, cached.fingerprintHash);
      const snap = await getDoc(docRef);

      if (!snap.exists()) {
        await clearFpCache();
      } else {
        const data = snap.data() as any;
        const linkedEmail: string = data.email;
        if (linkedEmail === normalizedEmail) {
          updateDoc(docRef, { lastSeen: serverTimestamp() }).catch(() => { });
          writeFpCache({
            fingerprintHash: cached.fingerprintHash,
            email: normalizedEmail,
            source: cached.source,
          }).catch(() => { });
          return {
            allowed: true,
            relinksRemaining: MAX_ACCOUNT_RELINKS - (data.relinkCount ?? 0),
          };
        }
        // Cache says a different account is now being used on this device;
        // fall through to the full gate so the relink logic/limit applies.
        await clearFpCache();
      }
    } catch (err) {
      console.warn("Cached FP Firestore read failed (failing open):", err);
      return { allowed: true };
    }
  }

  try {
    const { hash, source } = await getDeviceFingerprint();
    return checkHybridFingerprintGate(hash, normalizedEmail, source);
  } catch (err) {
    console.warn("Full FP recompute failed (failing open):", err);
    return { allowed: true };
  }
}

// ─── FingerprintBlockScreen (plain JSX, no Modal) ─────────────────────────────
// Full-block screen shown when the device has used up all its relinks and is
// locked to a different account than the one currently signed in.

interface FingerprintBlockScreenProps {
  linkedEmail: string;
  currentUserEmail: string;
  onDismiss: () => void;
  onLogout: () => void;
}

function FingerprintBlockScreen({
  linkedEmail,
  currentUserEmail,
  onDismiss,
  onLogout,
}: FingerprintBlockScreenProps) {
  const isAdmin = ADMIN_EMAILS.has(currentUserEmail.trim().toLowerCase());

  return (
    <View style={fpStyles.overlay}>
      <View style={fpStyles.card}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, }}>
          <View style={fpStyles.iconWrap}>
            <Ionicons name="shield-checkmark-outline" size={22} color="#f97316" />
          </View>
          <View style={fpStyles.emailBlock}>
            <Text style={fpStyles.emailLabel}>Login with this email</Text>
            <Text style={fpStyles.emailValue}>{linkedEmail}</Text>
          </View>
        </View>


        <TouchableOpacity style={fpStyles.logoutBtn} onPress={onLogout} activeOpacity={0.85}>
          <Ionicons name="log-out-outline" size={18} color="#fff" style={{ marginRight: 8 }} />
          <Text style={fpStyles.logoutText}>Sign out</Text>
        </TouchableOpacity>

        {isAdmin ? (
          <TouchableOpacity style={fpStyles.dismissBtn} onPress={onDismiss} activeOpacity={0.75}>
            <Text style={fpStyles.dismissText}>Admin: Dismiss</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={fpStyles.dismissBtn} onPress={() => router.navigate("./comments")} activeOpacity={0.75}>
            <Text style={[fpStyles.dismissText, { textDecorationLine: "underline", color: "blue" }]}>Message Admin</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

// ─── RelinkNotice (plain JSX banner, no Modal) ────────────────────────────────
// Small dismissible banner shown right after a device successfully switches
// to a new account, telling the user how many corrections they have left.

interface RelinkNoticeProps {
  relinksRemaining: number;
  onDismiss: () => void;
}

function RelinkNotice({ relinksRemaining, onDismiss }: RelinkNoticeProps) {
  return (
    <View style={fpStyles.noticeBar}>
      <Ionicons name="swap-horizontal-outline" size={16} color="#fff" style={{ marginRight: 8 }} />
      <Text style={fpStyles.noticeText}>
        Device switched to this account. {relinksRemaining}{" "}
        {relinksRemaining === 1 ? "correction" : "corrections"} left.
      </Text>
      <TouchableOpacity onPress={onDismiss} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
        <Ionicons name="close" size={16} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

const fpStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", alignItems: "center", paddingHorizontal: 24, position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 999 },
  card: { backgroundColor: "#fff", borderRadius: 16, paddingHorizontal: 10, paddingVertical: 15, width: "100%", maxWidth: 300, alignItems: "center", borderWidth: 1, borderColor: "#eee" },
  iconWrap: { padding: 8, borderRadius: 30, backgroundColor: "#faece0ff", alignItems: "center", justifyContent: "center", marginBottom: 12 },
  title: { fontSize: 17, fontWeight: "700", color: "#1a1a1a", marginBottom: 12, textAlign: "center" },
  emailBlock: { backgroundColor: "#fff", borderRadius: 10, paddingVertical: 5, paddingHorizontal: 10, alignItems: "center", marginBottom: 10, },
  emailLabel: { fontSize: 11, color: "#da7542ff", marginBottom: 3, textTransform: "uppercase", letterSpacing: 0.5 },
  emailValue: { fontSize: 15, fontWeight: "700", color: "#f97316", textAlign: "center" },
  hint: { fontSize: 12, color: "#999", textAlign: "center", paddingHorizontal: 8, lineHeight: 17 },
  logoutBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: "#f97316", borderRadius: 12, paddingVertical: 11, paddingHorizontal: 32, marginBottom: 14, width: "60%" },
  logoutText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  dismissBtn: { paddingHorizontal: 20, paddingVertical: 4 },
  dismissText: { fontSize: 13, fontWeight: "600", color: "#ef4444" },
  noticeBar: { flexDirection: "row", alignItems: "center", backgroundColor: "#16a34a", paddingVertical: 8, paddingHorizontal: 14 },
  noticeText: { flex: 1, color: "#fff", fontSize: 12, fontWeight: "600" },
});

// ─── Member List Item ─────────────────────────────────────────────────────────

interface MemberListItemProps {
  item: MemberItem;
  userId: string;
  isOnline: boolean;
  onPress: (item: MemberItem) => void;
  truncateMiddle: (value?: string, start?: number, end?: number) => string | undefined;
}

const MemberListItem = React.memo(function MemberListItem({
  item, userId, isOnline, onPress, truncateMiddle,
}: MemberListItemProps) {
  const isCurrentUser = item.clientId === userId;

  return (
    <TouchableOpacity
      onPress={() => onPress(item)}
      style={[itemStyles.container, isCurrentUser && itemStyles.currentUserBg]}
      activeOpacity={0.7}
    >
      <View style={[itemStyles.avatarRing, { borderColor: isOnline ? "#16d51f" : "#eee" }]}>
        <Image
          source={require("@/assets/images/userImagePlaceHolder.png")}
          style={itemStyles.avatarPlaceholder}
          resizeMode="cover"
        />
        {typeof item.iconUrl === "string" ? (
          <Image source={{ uri: item.iconUrl }} style={itemStyles.avatarImage} resizeMode="cover" />
        ) : (
          <View style={[itemStyles.avatarInitials, { backgroundColor: item.iconUrl?.color || "#ccc" }]}>
            <Text style={itemStyles.avatarLetter}>{item.iconUrl?.letter || "U"}</Text>
          </View>
        )}
        {isOnline && <View style={itemStyles.onlineDot} />}
      </View>

      <View style={itemStyles.textBlock}>
        <Text numberOfLines={1} style={itemStyles.name}>
          {isCurrentUser ? "You: " : ""}<Text style={{ fontSize: 15 }}>{item.clientName}</Text>
        </Text>
        <View style={itemStyles.metaRow}>
          <Text numberOfLines={1} style={itemStyles.email}>{truncateMiddle(item?.email, 0, 17)}</Text>
        </View>
      </View>

      <View style={itemStyles.timeBlock}>
        <Text style={itemStyles.timeText}>
          {item.createdAt?.seconds
            ? new Date(item.createdAt.seconds * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
            : "Now"}
        </Text>
        <Text style={itemStyles.dateText}>
          {item.createdAt?.seconds
            ? timeAgo(new Date(item.createdAt.seconds * 1000))
            : new Date().toLocaleDateString("en-GB")}
        </Text>
      </View>
    </TouchableOpacity>
  );
});

const itemStyles = StyleSheet.create({
  container: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: "#eee", backgroundColor: "#fff" },
  currentUserBg: { backgroundColor: "#fef0e5" },
  avatarRing: { width: 55, height: 55, borderRadius: 50, borderWidth: 1.5, padding: 2, alignItems: "center", justifyContent: "center", marginRight: 10, overflow: "hidden", backgroundColor: "#ffffff" },
  avatarPlaceholder: { width: "70%", height: "70%", position: "absolute" },
  avatarImage: { width: "100%", height: "100%", borderRadius: 25 },
  avatarInitials: { width: "100%", height: "100%", borderRadius: 25, alignItems: "center", justifyContent: "center" },
  avatarLetter: { color: "#fff", fontWeight: "700", fontSize: 16 },
  onlineDot: { position: "absolute", top: 2, right: 2, width: 12, height: 12, borderRadius: 6, backgroundColor: "#0ac213", borderWidth: 1.5, borderColor: "#fff" },
  textBlock: { flex: 1, gap: 3 },
  name: { fontWeight: "600", fontSize: 17, color: "#1a1a1a" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  email: { fontSize: 15, color: "#999", flex: 1 },
  timeBlock: { alignItems: "flex-end", gap: 4 },
  timeText: { fontSize: 11, color: "#888" },
  dateText: { fontSize: 11, color: "#aaa" },
});

// ─── Header ───────────────────────────────────────────────────────────────────

interface HeaderProps {
  counts: number;
  onRefresh: () => void;
  onClearSession: () => void;
  searchText: string;
  setSearchText: (text: string) => void;
}

const Header = React.memo(function Header({
  counts, onRefresh, onClearSession, searchText, setSearchText,
}: HeaderProps) {
  return (
    <View style={headerStyles.container}>
      <View style={headerStyles.row1}>
        <View style={headerStyles.brand}>
          <TouchableOpacity
            onPress={() => router.push("./welcome")}
            style={headerStyles.backBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="arrow-back" size={17} color="#34a73aff" />
          </TouchableOpacity>
          <View>
            <Text style={headerStyles.brandName}> eVotingSystemPro</Text>
            {/* <Text style={headerStyles.brandSub}>Community · {counts} members</Text> */}
          </View>
        </View>

        <View style={headerStyles.rightActions}>
          <TouchableOpacity onPress={onRefresh} style={headerStyles.walletBtn} activeOpacity={0.8}>
            <MaterialIcons name="account-balance-wallet" size={14} color="#fff" />
            <Text style={headerStyles.walletText}>Wallet</Text>
          </TouchableOpacity>
          <PopupMenu />
        </View>
      </View>

      <View style={headerStyles.divider}>
        <View style={headerStyles.dividerLine} />
        <View style={headerStyles.dividerDot} />
        <View style={headerStyles.dividerLine} />
      </View>

      <View style={headerStyles.row2}>
        {/* <TouchableOpacity onPress={() => router.navigate("./buy_reset_credit_screen")} style={headerStyles.creditBtn} activeOpacity={0.8}>
          <Ionicons name="add-circle-outline" size={15} color="#fff" />
          <Text style={headerStyles.actionBtnText}>Buy Credit</Text>
        </TouchableOpacity> */}

        {/*   <TouchableOpacity
          onPress={() => router.push({ pathname: "/chat/chat_room", params: { clientName: "Lydia Fauson", clientUriLetter: "", clientUriColor: "", clientIconUri: "ai_image" } })}
          style={headerStyles.helpBtn}
          activeOpacity={0.8}
        >
          <Ionicons name="chatbubble-ellipses-outline" size={13} color="#fff" />
          <Text style={headerStyles.actionBtnText}>Help</Text>
        </TouchableOpacity> */}

        <View style={headerStyles.searchWrap}>
          <Ionicons name="search-outline" size={22} color="#000" style={headerStyles.searchIcon} />
          <TextInput
            placeholder="Search potential voters…"
            placeholderTextColor="#5d626aff"
            maxLength={25}
            style={headerStyles.searchInput}
            value={searchText}
            onChangeText={setSearchText}
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
          />
          {searchText.length > 0 && (
            <TouchableOpacity onPress={() => setSearchText("")} style={headerStyles.clearBtn} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
              <Ionicons name="close-circle" size={15} color="#ccc" />
            </TouchableOpacity>
          )}
        </View>

        {/*  <TouchableOpacity style={headerStyles.logoutBtn} onPress={onClearSession} activeOpacity={0.8} hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}>
          <Ionicons name="log-out-outline" size={15} color="#fff" />
        </TouchableOpacity> */}
      </View>
    </View>
  );
});

const headerStyles = StyleSheet.create({
  container: { backgroundColor: "#fff", borderBottomWidth: 0.5, borderBottomColor: "#e8e8e8", paddingHorizontal: 12, paddingTop: 10, paddingBottom: 8 },
  row1: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  brand: { flexDirection: "row", alignItems: "center", gap: 5 },
  backBtn: { width: 30, height: 30, borderRadius: 16, backgroundColor: "#d1e4d5ff", alignItems: "center", justifyContent: "center" },
  brandName: { fontSize: 18, fontWeight: "700", color: "#51985aff", letterSpacing: -0.3 },
  brandSub: { fontSize: 10, color: "#aaa", marginTop: -1 },
  rightActions: { flexDirection: "row", alignItems: "center", gap: 6 },
  walletBtn: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#16a34a", borderRadius: 20, paddingVertical: 5, paddingHorizontal: 12 },
  walletText: { color: "#fff", fontWeight: "600", fontSize: 15 },
  divider: { flexDirection: "row", alignItems: "center", marginBottom: 9, paddingHorizontal: 4 },
  dividerLine: { flex: 1, height: 0.5, backgroundColor: "#f97316" },
  dividerDot: { width: 60, height: 6, borderRadius: 10, backgroundColor: "#ddd", marginHorizontal: 6 },
  row2: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 4 },
  creditBtn: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#ef4444", borderRadius: 20, paddingVertical: 5, paddingHorizontal: 10, paddingRight: 12 },
  helpBtn: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#f59e0b", borderRadius: 20, paddingVertical: 5, paddingHorizontal: 12, paddingRight: 15 },
  actionBtnText: { color: "#fff", fontWeight: "600", fontSize: 14 },
  searchWrap: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 20, backgroundColor: "#eaeaf6ff", paddingHorizontal: 8, paddingVertical: 4, width: "96%" },
  searchIcon: { marginRight: 3 },
  searchInput: { flex: 1, fontSize: 13, color: "#333", paddingVertical: 5, minWidth: 0, ...(Platform.OS === "web" && { outlineStyle: "none", outlineWidth: 0 } as any) },
  clearBtn: { padding: 2 },
  logoutBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: "#ef4444", alignItems: "center", justifyContent: "center" },
});

// ─── Earn Real Cash Button styles ─────────────────────────────────────────────

const earnStyles = StyleSheet.create({
  floatContainer: { position: "absolute", bottom: 90, left: 50, right: 50, alignItems: "center", zIndex: 99, pointerEvents: "box-none" as any },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", borderRadius: 30, paddingVertical: 10, paddingHorizontal: 20, overflow: "hidden", backgroundColor: "#16a34a", shadowColor: "#16a34a", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.45, shadowRadius: 10, elevation: 8 },
  shimmer: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: 30, backgroundColor: "transparent", borderWidth: 1.5, borderColor: "rgba(255,255,255,0.25)" },
  btnText: { color: "#fff", fontWeight: "600", fontSize: 15, letterSpacing: 0.3 },
});

// ─── Main Component ───────────────────────────────────────────────────────────

export default function MembersList() {
  const { logout } = useLogout();
  const {
    userName, userPassword, rawUserEmail, userId, userPhotoUrl,
    clientsOnlineStatus, app_update_status, setApp_update_status,
    app_update_description, app_update_version, app_update_title,
    setTraditionalAuth,
  } = useContext(GlobalContext);

  const { contacts } = useChatListListener(userId);
  const isConnectedNET = useNetworkStatus();
  const { signOut } = useAuth();
  const { members, loading } = useMembersListener();

  const [deviceCheckDone, setDeviceCheckDone] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [showLoader, setShowLoader] = useState(true);
  const [searchText, setSearchText] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [fpBlocked, setFpBlocked] = useState(false);
  const [fpLinkedEmail, setFpLinkedEmail] = useState("");
  const [relinksRemaining, setRelinksRemaining] = useState<number | null>(null);
  const [showRelinkNotice, setShowRelinkNotice] = useState(false);

  const initDone = useRef(false);

  useFocusEffect(
    useCallback(() => {
      if (!userName) router.replace("/");
    }, [userName])
  );

  useEffect(() => {
    (async () => {
      const id = await getDeviceId();
      setDeviceId(id);
    })();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setShowLoader(false), 500);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchText), 300);
    return () => clearTimeout(t);
  }, [searchText]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [debouncedSearch]);

  useEffect(() => {
    if (!rawUserEmail) return;
    const normalizedEmail = rawUserEmail.trim().toLowerCase();

    (async () => {
      try {
        const stored = await AsyncStorage.getItem(DEVICE_VERIFIED_KEY);
        if (stored) {
          const { email, verifiedAt } = JSON.parse(stored);
          const isValid = email === normalizedEmail && Date.now() - verifiedAt < FP_CACHE_TTL_MS;

          if (isValid) {
            setDeviceCheckDone(true);
            const cached = await readFpCache();
            if (cached) {
              const docRef = doc(db, HYBRID_FP_COLLECTION, cached.fingerprintHash);
              getDoc(docRef).then((snap) => {
                if (!snap.exists()) {
                  clearFpCache();
                  AsyncStorage.removeItem(DEVICE_VERIFIED_KEY);
                  setFpLinkedEmail("");
                  setFpBlocked(true);
                  return;
                }
                const data = snap.data() as any;
                if (data.email !== normalizedEmail) {
                  // Account on this device changed since we last checked
                  // (e.g. relinked from another screen/session). Re-run the
                  // gate so the relink allowance is applied consistently.
                  clearFpCache();
                  AsyncStorage.removeItem(DEVICE_VERIFIED_KEY);
                  runFingerprintGateWithCache(rawUserEmail).then((result: any) => {
                    if (!result.allowed) {
                      setFpLinkedEmail(result.linkedEmail);
                      setFpBlocked(true);
                    } else {
                      if (typeof result.relinksRemaining === "number") {
                        setRelinksRemaining(result.relinksRemaining);
                      }
                      if (result.relinked) setShowRelinkNotice(true);
                      AsyncStorage.setItem(
                        DEVICE_VERIFIED_KEY,
                        JSON.stringify({ email: normalizedEmail, verifiedAt: Date.now() })
                      );
                    }
                  });
                } else {
                  updateDoc(docRef, { lastSeen: serverTimestamp() }).catch(() => { });
                  writeFpCache({ fingerprintHash: cached.fingerprintHash, email: normalizedEmail, source: cached.source }).catch(() => { });
                  AsyncStorage.setItem(DEVICE_VERIFIED_KEY, JSON.stringify({ email: normalizedEmail, verifiedAt: Date.now() }));
                }
              }).catch(() => { });
            }
            return;
          }
        }

        const result: any = await runFingerprintGateWithCache(rawUserEmail);
        if (!result.allowed) {
          await clearFpCache();
          await AsyncStorage.removeItem(DEVICE_VERIFIED_KEY);
          setFpLinkedEmail(result.linkedEmail);
          setFpBlocked(true);
        } else {
          if (typeof result.relinksRemaining === "number") {
            setRelinksRemaining(result.relinksRemaining);
          }
          if (result.relinked) setShowRelinkNotice(true);
          await AsyncStorage.setItem(DEVICE_VERIFIED_KEY, JSON.stringify({ email: normalizedEmail, verifiedAt: Date.now() }));
        }
      } catch (err) {
        console.warn("FP gate failed (failing open):", err);
      } finally {
        setDeviceCheckDone(true);
      }
    })();
  }, [rawUserEmail]);

  useEffect(() => {
    const t = setTimeout(() => setShowLoader(false), deviceCheckDone ? 0 : 500);
    return () => clearTimeout(t);
  }, [deviceCheckDone]);

  useEffect(() => {
    if (!userId || !deviceId) return;
    const unsubscribe = onSnapshot(doc(db, "user_sessions", userId), (snap) => {
      if (!snap.exists()) return;
      if (snap.data().activeDeviceId !== deviceId) {
        logout();
        router.replace("/");
      }
    });
    return unsubscribe;
  }, [userId, deviceId, logout]);



  /* ── Silent Firebase Email Auth ── */

  const PASSWORD = "NoPassword1234";
  useEffect(() => {
    if (!userId || !isConnectedNET) return;
    (async () => {
      try {
        const cached = await AsyncStorage.getItem("HAS_SIGN_IN_WITH_EMAIL_AND_PASSWORD");
        const isCachedForThisUser = cached && JSON.parse(cached).userId === userId;
        if (isCachedForThisUser) return;

        try {
          await createUserWithEmailAndPassword(auth, userId, PASSWORD);
        } catch (err: any) {
          if (err?.code !== "auth/email-already-in-use") {
            console.error("❌ Auth failed:", err);
            return;
          }
        }

        await AsyncStorage.setItem(
          "HAS_SIGN_IN_WITH_EMAIL_AND_PASSWORD",
          JSON.stringify({ userId, authenticatedAt: Date.now() })
        );
      } catch (authErr) {
        console.error("❌ Auth failed — aborting init:", authErr);
      }
    })();
  }, [userId, isConnectedNET]);



  useEffect(() => {
    if (!userId || !deviceId || !isConnectedNET) return;
    if (initDone.current) return;
    initDone.current = true;

    (async () => {
      try {
        await setDoc(
          doc(db, "user_sessions", userId),
          { activeDeviceId: deviceId, platform: Platform.OS, lastLoginAt: serverTimestamp() },
          { merge: true }
        );
      } catch (err) {
        console.warn("user_sessions write failed:", err);
      }

      try {
        const memberRef = doc(db, "members_list_db", userId);
        const existingDoc = await getDoc(memberRef);

        if (!existingDoc.exists()) {
          const now = Date.now();
          await setDoc(memberRef, {
            clientId: userId,
            clientName: userName || "Unnamed User",
            userPassword: userPassword || "NoPassword",
            phone: "+233509876543",
            email: userId || "unknown@example.com",
            rawUserEmail: rawUserEmail || "unknown@example.com",
            createdAt: serverTimestamp(),
            year: new Date().getFullYear(),
            current_reward: "None",
            badges: 0,
            membership_status: "registered",
            ownerUid: userId,
            iconUrl: userPhotoUrl
              ? userPhotoUrl
              : {
                type: "generated",
                letter: (userName || "U").charAt(0).toUpperCase(),
                color: "#" + Math.floor(Math.random() * 16777215).toString(16).padStart(6, "0"),
              },
          });

          try {
            const scoreboardRef = doc(db, "SCOREBOARD_V5", userId);
            const scoreboardSnap = await getDoc(scoreboardRef);
            if (!scoreboardSnap.exists()) {
              await setDoc(scoreboardRef, {
                sub: userId, user: userName || "Unknown", email: userId,
                userPhotoUrl: userPhotoUrl || "", currentCorrectScore: "0",
                estimatedTotalScore: "0", totalScore: "0", totalWrongScore: "0",
                likes: 0, dislikes: 0, hearts: 0, status: "online",
                timestamp: now, createdAt: serverTimestamp(),
              });
            }
          } catch (err) {
            console.error("SCOREBOARD_V5 creation failed:", err);
          }

          /*  fetch(PUSH_NOTIFICATION_URL, {
             method: "POST",
             headers: { "Content-Type": "application/json" },
             body: JSON.stringify({
               title: "New user added",
               body: rawUserEmail || "Unknown email",
               data: { screen: "chat/members_list", commentId: 0 },
             }),
           }).catch((err) => console.warn("Push notification failed:", err)); */
        } else {
          if (userPassword) {
            updateDoc(memberRef, { userPassword }).catch((err) =>
              console.warn("userPassword update failed:", err)
            );
          }
        }
      } catch (err) {
        console.error("members_list_db write failed:", err);
      }

      try {
        const walletRef = doc(db, "WALLET_DB", userId);
        const walletSnap = await getDoc(walletRef);
        if (!walletSnap.exists()) {
          await setDoc(walletRef, {
            email: userId, free_reset_credit: 15,
            monthly_subscription_plan: { expires_at: null, is_active: false, is_suspended: false, last_purchased_at: null, started_at: null, suspension_started_at: null, total_purchases: 0 },
            pay_as_you_go: { date_subscribed: null }, plan_id: "", transaction_type: "",
            previous_balance: null, current_balance: null, transaction_amount: null,
            currency: "GHS", payment_method: "system transfer", createdAt: serverTimestamp(),
          });
        }
      } catch (err) {
        console.error("WALLET_DB write failed:", err);
      }
    })();
  }, [userId, deviceId, isConnectedNET]); // eslint-disable-line react-hooks/exhaustive-deps

  const visibleMembers = useMemo<MemberItem[]>(() => {
    if (!members?.length) return [];
    let list = members.filter((m) => m.clientId !== userId);
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      list = list.filter((m) => m.clientName?.toLowerCase().startsWith(q));
    }
    list = [...list].sort((a, b) => {
      const aOn = clientsOnlineStatus[a.email]?.state === "online" ? 1 : 0;
      const bOn = clientsOnlineStatus[b.email]?.state === "online" ? 1 : 0;
      return bOn - aOn;
    });
    return list.slice(0, visibleCount).map((member) => ({
      clientId: member.clientId,
      clientName: member.clientName,
      email: member.email,
      iconUrl: member.iconUrl,
      phone: member.phone,
      ...member,
    })) as MemberItem[];
  }, [members, visibleCount, userId, debouncedSearch, clientsOnlineStatus]);

  const currentUser = useMemo<MemberItem | null>(() => {
    const member = members?.find((m) => m.clientId === userId);
    if (!member) return null;
    return { clientId: member.clientId, clientName: member.clientName, email: member.email, iconUrl: member.iconUrl, phone: member.phone, ...member } as MemberItem;
  }, [members, userId]);

  const handleClearSession = useCallback(async () => {
    try {
      await clearFpCache();
      await AsyncStorage.removeItem(DEVICE_VERIFIED_KEY);
      await AsyncStorage.removeItem("HAS_SIGN_IN_WITH_EMAIL_AND_PASSWORD");
      await signOut?.();

      if (Platform.OS === "web") {
        await AsyncStorage.clear();
        localStorage.clear();
        sessionStorage.clear();
        window.location.replace("/");
        return;
      }

      await AsyncStorage.clear();
      setTraditionalAuth(null);
      await Updates.reloadAsync();
      router.replace("/");
    } catch (e) {
      console.error("Logout failed:", e);
    }
  }, [signOut, setTraditionalAuth]);

  const truncateMiddle = useCallback(
    (value?: string, start = 6, end = 6): string | undefined => {
      if (!value || value.length <= start + end) return value;
      return `${value.slice(0, start)}…${value.slice(-end)}`;
    },
    []
  );

  const loadMore = useCallback(() => {
    if (loadingMore || visibleCount >= members.length) return;
    setLoadingMore(true);
    setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, members.length));
    setTimeout(() => setLoadingMore(false), 50);
  }, [loadingMore, visibleCount, members.length]);

  const navigateToChat = useCallback(
    (item: MemberItem) => {
      setSearchText("");
      if (item.clientId === userId) {
        router.navigate("./userChatMessages");
      } else {
        router.navigate({
          pathname: "/chat/chat_room",
          params: {
            clientName: item.clientName ?? "",
            clientUriLetter: typeof item.iconUrl === "object" ? item.iconUrl?.letter ?? "" : "",
            clientUriColor: typeof item.iconUrl === "object" ? item.iconUrl?.color ?? "" : "",
            clientIconUri: typeof item.iconUrl === "string" ? item.iconUrl : null,
            clientPhone: item.phone ?? "",
            clientEmail: item.email ?? "",
          },
        });
      }
    },
    [userId]
  );

  const renderItem = useCallback(
    ({ item }: { item: MemberItem }) => (
      <MemberListItem
        item={item}
        userId={userId}
        isOnline={clientsOnlineStatus[item.email]?.state === "online"}
        onPress={navigateToChat}
        truncateMiddle={truncateMiddle}
      />
    ),
    [clientsOnlineStatus, userId, navigateToChat, truncateMiddle]
  );

  const keyExtractor: any = useCallback((item: MemberItem) => item.clientId ?? item.id, []);

  const ListHeader = useMemo(() => {
    if (!currentUser) return null;
    return (
      <MemberListItem
        item={currentUser}
        userId={userId}
        isOnline={false}
        onPress={navigateToChat}
        truncateMiddle={truncateMiddle}
      />
    );
  }, [currentUser, userId, navigateToChat, truncateMiddle]);

  const ListFooter = useMemo(
    () => loading ? <ActivityIndicator size="small" color="#fd7506" style={{ paddingVertical: 16 }} /> : null,
    [loading]
  );

  const ListEmpty = useMemo(
    () => (
      <View style={globalStyles.emptyContainer}>
        <Ionicons name="people-outline" size={40} color="#ddd" />
        <Text style={globalStyles.emptyText}>No members found</Text>
      </View>
    ),
    []
  );

  const setApp_update_status_action = () => {
    setApp_update_status(Platform.OS === "web" ? false : !isConnectedNET ? false : true)
    router.navigate("/");
  }


  if (!deviceCheckDone || showLoader) {
    return (
      <ReusableScreen>
        <View style={globalStyles.loaderContainer}>
          <ActivityIndicator size="large" color="#1f9b11ff" />
          {!deviceCheckDone && <Text style={globalStyles.loaderText}>Verifying device…</Text>}
        </View>
      </ReusableScreen>
    );
  }

  return (
    <ReusableScreen>
      <MenuProvider>
        <ChatBanner />

        {fpBlocked && (
          <FingerprintBlockScreen
            linkedEmail={fpLinkedEmail}
            currentUserEmail={rawUserEmail ?? ""}
            onDismiss={() => setFpBlocked(false)}
            onLogout={handleClearSession}
          />
        )}

        {showRelinkNotice && relinksRemaining !== null && (
          <RelinkNotice
            relinksRemaining={relinksRemaining}
            onDismiss={() => setShowRelinkNotice(false)}
          />
        )}

        <AnnouncementModalComponentAppUpdate
          visible={app_update_status}
          app_update_title={app_update_title ? app_update_title : "Update info…"}
          app_update_description={
            app_update_description
              ? app_update_description
              : "We're having trouble reaching our servers. Please check your internet connection and try again."
          }
          onCancel={() => setApp_update_status_action()}
          confirmText="View Profile"
          cancelText="Dismiss"
          confirmColor="#f59e0b"
          cancelColor="#6b7280"
          onProfile={() => router.replace("./profile")}
          onComment={() => router.replace("./comments")}
          app_update_version={app_update_version}
        />

        <View style={{ flex: 1 }}>
          <Header
            counts={members.length}
            onRefresh={() => router.navigate("./profile")}
            onClearSession={handleClearSession}
            searchText={searchText}
            setSearchText={setSearchText}
          />

          <FlashList
            data={visibleMembers}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            estimatedItemSize={ITEM_HEIGHT}
            drawDistance={250}
            ListHeaderComponent={ListHeader}
            ListFooterComponent={ListFooter}
            ListEmptyComponent={ListEmpty}
            onEndReachedThreshold={0.5}
            onEndReached={() => { if (!loading) loadMore(); }}
            onScroll={({ nativeEvent }) => {
              const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
              const distanceFromBottom = contentSize.height - (layoutMeasurement.height + contentOffset.y);
              if (distanceFromBottom < 120) loadMore();
            }}
            scrollEventThrottle={16}
            contentContainerStyle={{ paddingBottom: 5 }}
          />

          <View style={earnStyles.floatContainer} pointerEvents="box-none">
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View>
                <TouchableOpacity style={earnStyles.btn} onPress={() => router.navigate("./PollsListScreen")} activeOpacity={0.82}>
                  <View style={earnStyles.shimmer} />
                  <Ionicons name="thumbs-down-sharp" size={18} color="#fff" style={{ marginRight: 7 }} />
                  <Text style={earnStyles.btnText}>Vote</Text>
                </TouchableOpacity>
              </View>
            </View>


          </View>

          <BottomNav />
        </View>
      </MenuProvider>
    </ReusableScreen>
  );
}

const globalStyles = StyleSheet.create({
  loaderContainer: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#fff" },
  loaderText: { color: "#aaa", marginTop: 12, fontSize: 13 },
  emptyContainer: { paddingVertical: 48, alignItems: "center", gap: 10 },
  emptyText: { color: "#bbb", fontSize: 15 },
});
