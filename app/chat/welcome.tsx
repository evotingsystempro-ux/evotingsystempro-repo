// welcome.tsx
import React, {
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  Image,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import ReusableScreen from "@/components/ReusableScreen";
import { GlobalContext } from "@/context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { UserStorageKeys } from "@/hooks/storageKeys";
import { usePushNotification } from "@/hooks/usePushNotification";
import { onDisconnect, onValue, ref, set } from "firebase/database";
import { auth, createUserWithEmailAndPassword, rtdb } from "@/firebase";
import ChatBanner from "@/components/ChatBanner";
import { useAuth } from "@/context/auth";
import * as Updates from "expo-updates";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Constants                                                                  */
/* ─────────────────────────────────────────────────────────────────────────── */
const FP_CACHE_KEY = "device_fp_cache";
const PASSWORD = "NoPassword1234";

const sanitizeEmail = (email: string) =>
  email.replace(/\./g, "_").replace(/@/g, "_at_");

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Design Tokens                                                              */
/* ─────────────────────────────────────────────────────────────────────────── */
const C = {
  brand: "#1F9F4E",
  brandDeep: "#166534",
  brandLight: "#D1FAE5",
  brandBorder: "#A7F3D0",
  brandMuted: "#6FCF97",
  white: "#FFFFFF",
  ink: "#1A2E22",
  inkSoft: "#374151",
  inkMuted: "#6B7280",
  bg: "#F0FDF4",
  cardBg: "#FFFFFF",
  cardBorder: "#A7F3D0",
};

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Sub-components                                                             */
/* ─────────────────────────────────────────────────────────────────────────── */
interface FeatureItemProps {
  icon: string;
  color: string;
  title: string;
  description: React.ReactNode;
}

const FeatureItem = ({ icon, color, title, description }: FeatureItemProps) => (
  <View style={styles.listItem}>
    <View style={[styles.iconWrapper, { backgroundColor: color + "18" }]}>
      <Ionicons name={icon as any} size={18} color={color} />
    </View>
    <View style={{ flex: 1 }}>
      <Text style={styles.featureTitle}>{title}</Text>
      <Text style={styles.listText}>{description}</Text>
    </View>
  </View>
);

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Features Card                                                              */
/* ─────────────────────────────────────────────────────────────────────────── */
const FeaturesCard: React.FC = () => (
  <View style={styles.textBox}>

    {/* ── Card Header ── */}
    <View style={styles.cardHeader}>
      <View style={styles.cardIconWrap}>
        <Ionicons name="checkmark-circle" size={18} color={C.white} />
      </View>
      <Text style={styles.cardHeaderText}>Platform Features</Text>
    </View>

    <View style={styles.divider} />

    {/* ── Feature 1 ── */}
    <FeatureItem
      icon="radio-button-on"
      color="#1F9F4E"
      title="Unique / Single-Choice Poll"
      description={
        <>
          Create polls where each voter selects{" "}
          <Text style={styles.highlightGreen}>exactly one candidate</Text>
        </>
      }
    />

    {/* ── Feature 2 ── */}
    <FeatureItem
      icon="checkbox"
      color="#2563EB"
      title="Multiple-Choice Poll"
      description={
        <>
          Voters can cast{" "}
          <Text style={styles.highlightOrange}>multiple </Text> votes for multiple candidates. Each vote costs <Text style={styles.highlightBlue}>1 vote = 1GHC.00 </Text>, generate revenue for the platform while giving your favorite candidate a better chance of winning.
        </>
      }
    />

    {/* ── Feature 4 ── */}
    <FeatureItem
      icon="document-attach"
      color="#7C3AED"
      title="Import Eligible Voters"
      description={
        <>
          Upload a{" "}
          <Text style={styles.highlightPurple}>CSV, Excel, or Text file</Text>{" "}
          of eligible voters. Only registered voters on your list can participate
          to keep the election secure and verified.
        </>
      }
    />

    {/* ── Feature 5 ── */}
    <FeatureItem
      icon="time"
      color="#DB2777"
      title="Scheduled Ending Windows"
      description={
        <>
          Set a precise{" "}
          <Text style={styles.highlightPink}>end time</Text> for your
          poll. Voting automatically opens after publishing the poll, with notifications sent to voters / eligible voters immediately.
        </>
      }
    />

    {/* ── Feature 6 ── */}
    <FeatureItem
      icon="bar-chart"
      color="#0891B2"
      title="Real-Time Results"
      description={
        <>
          Results are updated instantly {" "}
          <Text style={styles.highlightCyan}> in realtime as each vote is cast and verified.</Text>
        </>
      }
    />

    {/* ── Feature 7 ── */}
    <FeatureItem
      icon="shield-checkmark"
      color="#1F9F4E"
      title="Fraud Prevention & Security"
      description={
        <>
          Every vote is{" "}
          <Text style={styles.highlightGreen}>device-fingerprinted</Text> and
          server-verified. Duplicate votes, bots, and manipulation attempts are
          automatically blocked and flagged.
        </>
      }
    />

    {/* ── Feature 8 ── */}
    <FeatureItem
      icon="people"
      color="#EA580C"
      title="Voter Management Dashboard"
      description={
        <>
          View all registered voters, track who has voted, and manage{" "}
          <Text style={styles.highlightOrange}>voter eligibility</Text> from
          your admin dashboard in real time.
        </>
      }
    />

    {/* ── Feature 9 ── */}
    <FeatureItem
      icon="notifications"
      color="#7C3AED"
      title="Push Notification Alerts"
      description={
        <>
          Automatically notify eligible voters when a poll{" "}
          <Text style={styles.highlightPurple}>opens, closes, or results</Text>{" "}
          are published - via push notification or email.
        </>
      }
    />

    {/* ── Feature 10 ── */}
    <FeatureItem
      icon="download"
      color="#0891B2"
      title="Export Results"
      description={
        <>
          Download final results as a{" "}
          <Text style={styles.highlightCyan}>PDF or Excel report</Text> for
          official record-keeping, auditing, or public announcement.
        </>
      }
    />

  </View>
);

/* ──────────────── 550 = 120 + 70 + 130 + 30 + 100 = 100  ───────────────────────────────────────────────── */
/*  WelcomePage                                                                */
/* ─────────────────────────────────────────────────────────────────────────── */
export default function WelcomePage() {
  const router = useRouter();
  const { setTraditionalAuth, userId, userName } = useContext(GlobalContext);
  const isConnectedNET = useNetworkStatus();
  const { signOut: authSignOut } = useAuth();

  useFocusEffect(
    useCallback(() => {
      if (!userName) router.replace("/");
    }, [userName])
  );

  const [userTraditional, setUserTraditional] = useState<any | null>(null);
  const [isResetting, setIsResetting] = useState(false);

  usePushNotification(userId);

  /* ── Load cached credentials ── */
  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(
          UserStorageKeys.savedUserCredentials()
        );
        if (stored) setUserTraditional(JSON.parse(stored));
      } catch (e) {
        console.error("Storage read error:", e);
      }
    })();
  }, []);

  /* ── Firebase Realtime Presence ── */
  useEffect(() => {
    if (!userId) return;
    const safeId = sanitizeEmail(userId);
    const statusRef = ref(rtdb, `status/${safeId}`);
    const connectedRef = ref(rtdb, ".info/connected");

    const unsub = onValue(connectedRef, (snapshot) => {
      if (!snapshot.val()) return;
      onDisconnect(statusRef).set({ email: userId, state: "offline", lastSeen: Date.now() });
      set(statusRef, { email: userId, state: "online", lastSeen: Date.now() }).catch(
        (e) => console.error("Presence write error:", e)
      );
    });

    return () => unsub();
  }, [userId]);

  /* ── Silent Firebase Email Auth ── */
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

  /* ─────────────────────────────────────────────────────────────────────── */
  /*  handleClearSession                                                     */
  /* ─────────────────────────────────────────────────────────────────────── */
  const handleClearSession = useCallback(async () => {
    if (isResetting) return;
    setIsResetting(true);
    try {
      if (userId) {
        set(ref(rtdb, `status/${sanitizeEmail(userId)}`), {
          email: userId, state: "offline", lastSeen: Date.now(),
        }).catch(() => { });
      }

      await AsyncStorage.removeItem(FP_CACHE_KEY);
      await authSignOut?.();
      await AsyncStorage.clear();
      setTraditionalAuth?.(null);

      if (Platform.OS === "web") {
        try { localStorage.clear(); } catch (_) { }
        try { sessionStorage.clear(); } catch (_) { }
        window.location.replace("/");
        return;
      }

      await Updates.reloadAsync();
    } catch (e) {
      console.error("Logout failed:", e);
      router.replace("/");
    } finally {
      setIsResetting(false);
    }
  }, [isResetting, userId, authSignOut, setTraditionalAuth, router]);

  /* ─────────────────────────────────────────────────────────────────────── */
  /*  Render                                                                 */
  /* ─────────────────────────────────────────────────────────────────────── */
  return (
    <ReusableScreen>
      <ChatBanner />
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >

          {/* ── HEADER ── */}
          <View style={styles.headerRow}>
            <Image
              source={require("@/assets/images/LOGO.png")}
              style={styles.logo}
              resizeMode="contain"
            />
            <View style={{ gap: 7, alignItems: "center", }}>
              <Text style={styles.title}>eVoting System Pro</Text>
              <Text style={styles.subtitle}>Secure · Transparent · Precise</Text>
            </View>
          </View>

          {/* ── FEATURES CARD ── */}
          <FeaturesCard />

          {/* ── ACTION BUTTONS ── */}


          {/* ── LOGGED-IN USER PILL ── */}
          {userTraditional && userTraditional.email ? (
            <View style={styles.userPill}>
              <Ionicons name="person-circle-outline" size={15} color={C.brand} />
              <Text style={styles.userPillText} numberOfLines={1}>
                {String(userTraditional.email)}
              </Text>
            </View>
          ) : null}

        </ScrollView>

        {/* ── FOOTER ── */}
        <View style={styles.footerContainer}>
          <View style={styles.startContainer}>
            <TouchableOpacity
              onPress={() => (userId ? router.push("./members_list") : router.push("/"))}
              style={styles.startButton}
              activeOpacity={0.88}
            >
              <Text style={styles.startText}>Continue</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.demoButton} activeOpacity={0.88}>
              <Ionicons name="videocam-outline" size={18} color="#fff" />
              <Text style={styles.startText}>Demo</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.refreshButton, isResetting && { opacity: 0.6 }]}
              onPress={handleClearSession}
              activeOpacity={0.88}
              disabled={isResetting}
            >
              {isResetting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="log-out-outline" size={16} color="#fff" />
              )}
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    </ReusableScreen>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Styles                                                                     */
/* ─────────────────────────────────────────────────────────────────────────── */
const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: C.bg },
  scrollContent: { paddingVertical: 12, paddingHorizontal: 16, paddingBottom: 20 },

  /* ── Header ── */
  headerRow: {
    flexDirection: "row", alignSelf: "center",
    marginBottom: 14, gap: 5, alignItems: "center",
  },
  logoContainer: { borderRadius: 30 },
  logo: { width: 60, height: 60, borderRadius: 26, },
  title: {
    fontSize: 20.7, fontWeight: "900",
    color: C.brand, letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 11.97, color: C.inkMuted,
    fontWeight: "600", letterSpacing: 0.3,
    textTransform: "uppercase",
  },

  /* ── Welcome Banner ── */
  welcomeBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: C.brand,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
    marginBottom: 14,
  },
  welcomeText: {
    color: C.white, fontSize: 15.39, fontWeight: "500",
  },

  /* ── Features Card ── */
  textBox: {
    backgroundColor: C.cardBg, borderRadius: 16,
    paddingTop: 14, paddingBottom: 8,
    borderWidth: 1, borderColor: C.cardBorder,
  },
  cardHeader: {
    flexDirection: "row", alignItems: "center",
    gap: 8, paddingHorizontal: 16, marginBottom: 10,
  },
  cardIconWrap: {
    width: 28, height: 28, borderRadius: 8,
    backgroundColor: C.brand,
    alignItems: "center", justifyContent: "center",
  },
  cardHeaderText: {
    fontSize: 14.54, fontWeight: "800",
    color: C.ink, textTransform: "uppercase", letterSpacing: 0.5,
  },
  divider: { height: 1, backgroundColor: C.brandLight, marginBottom: 12 },

  listItem: {
    flexDirection: "row", alignItems: "flex-start",
    marginBottom: 14, paddingHorizontal: 14, gap: 10,
  },
  iconWrapper: {
    width: 34, height: 34, borderRadius: 9,
    alignItems: "center", justifyContent: "center",
    flexShrink: 0, marginTop: 1,
  },
  featureTitle: {
    fontSize: 14.96, fontWeight: "700",
    color: C.ink, marginBottom: 3,
  },
  listText: {
    fontSize: 14.54, lineHeight: 24.7, color: C.inkSoft,
  },

  /* ── Action Buttons ── */
  startContainer: {
    marginTop: 20, flexDirection: "row",
    justifyContent: "center", gap: 10,
  },
  startButton: {
    backgroundColor: C.brand, borderRadius: 10,
    paddingHorizontal: 18, paddingVertical: 11,
    flexDirection: "row", alignItems: "center", gap: 6,
  },
  demoButton: {
    backgroundColor: "#94A3B8", borderRadius: 10,
    paddingHorizontal: 18, paddingVertical: 11,
    flexDirection: "row", alignItems: "center", gap: 6,
  },
  refreshButton: {
    alignItems: "center", backgroundColor: "#EF4444",
    flexDirection: "row", paddingHorizontal: 15,
    borderRadius: 50, paddingVertical: 11, justifyContent: "center",
  },
  startText: {
    color: "#fff", fontWeight: "700", fontSize: 14.54,
    textTransform: "uppercase", letterSpacing: 0.5,
  },

  /* ── User Pill ── */
  userPill: {
    flexDirection: "row", alignItems: "center",
    alignSelf: "center", gap: 5, marginTop: 16,
    backgroundColor: C.brandLight, borderWidth: 1,
    borderColor: C.brandBorder, borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 5, maxWidth: "80%",
  },
  userPillText: { fontSize: 13.68, color: C.brandDeep, fontWeight: "600" },

  /* ── Footer ── */
  footerContainer: {
    paddingBottom: 17, borderTopWidth: 1,
    borderColor: C.brandBorder, alignItems: "center",
    backgroundColor: C.white,
  },
  footerBrand: { color: C.brand, fontWeight: "700", fontSize: 14.54 },
  footerTag: {
    color: C.inkMuted, fontSize: 11.97,
    marginTop: 2, letterSpacing: 0.3,
  },

  /* ── Text highlights ── */
  bold: { fontWeight: "700" },
  highlightGreen: { color: "#16A34A", fontWeight: "700" },
  highlightBlue: { color: "#2563EB", fontWeight: "700" },
  highlightPurple: { color: "#7C3AED", fontWeight: "700" },
  highlightRed: { color: "#EF4444", fontWeight: "700" },
  highlightOrange: { color: "#D97706", fontWeight: "700" },
  highlightPink: { color: "#DB2777", fontWeight: "700" },
  highlightCyan: { color: "#0891B2", fontWeight: "700" },
});
