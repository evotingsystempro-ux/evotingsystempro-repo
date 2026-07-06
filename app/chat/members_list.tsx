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
import { MenuProvider } from "react-native-popup-menu";
import { useChatListListener } from "@/hooks/useChatListListener";

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 15;
const ITEM_HEIGHT = 66;
const PUSH_NOTIFICATION_URL =
  "https://email-service-1054780588098.us-central1.run.app/push_notification";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MemberItem {
  clientId: string;
  clientName: string;
  email: string;
  phone?: string;
  iconUrl: string | { letter: string; color: string; type?: string };
  createdAt?: { seconds: number };
  [key: string]: unknown;
}

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
          <Ionicons name="search-outline" size={21} color="#9ca3af" style={headerStyles.searchIcon} />
          <TextInput
            placeholder="Search…"
            placeholderTextColor="#9ca3af"
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
  searchWrap: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 20, backgroundColor: "#edeff0ff", paddingHorizontal: 8, paddingVertical: 4, width: "96%" },
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

  const [loadingMore, setLoadingMore] = useState(false);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [showLoader, setShowLoader] = useState(true);
  const [searchText, setSearchText] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

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

  // Enforce a single active device per account: whichever device most
  // recently wrote activeDeviceId to user_sessions "wins", and every other
  // device listening on this doc will see the mismatch below and log out.
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
        // Claiming this account for the current device. Any other device
        // currently subscribed to this doc will see activeDeviceId change
        // out from under it and will be logged out (see effect above).
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

  const keyExtractor = useCallback((item: MemberItem) => item.clientId ?? item.id, []);

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
    // router.navigate("/");
  }


  if (showLoader) {
    return (
      <ReusableScreen>
        <View style={globalStyles.loaderContainer}>
          <ActivityIndicator size="large" color="#1f9b11ff" />
        </View>
      </ReusableScreen>
    );
  }

  return (
    <ReusableScreen>
      <MenuProvider>
        <ChatBanner />

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
