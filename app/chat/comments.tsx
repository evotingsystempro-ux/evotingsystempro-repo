// comments_flashList.tsx
// Refined, production-ready cross-platform comments screen
// Features: empty state, skeleton loader, pull-to-refresh, haptic feedback,
//           long-press context menu, read receipts, typing indicator,
//           message search, reaction picker, offline retry, accessibility

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useContext,
  useMemo,
} from "react";
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  Image,
  StyleSheet,
  Animated,
  ViewStyle,
  Platform,
  ActivityIndicator,
  Pressable,
  RefreshControl,
  Keyboard,
  KeyboardAvoidingView,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  collection,
  doc,
  setDoc,
  serverTimestamp,
  increment,
  deleteDoc,
} from "firebase/firestore";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { db } from "@/firebase";
import ReusableScreen from "@/components/ReusableScreen";
import Modal from "react-native-modal";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { AnimatedMessage } from "@/components/AnimatedMessage";
import { GlobalContext } from "@/context";
import { UserStorageKeys } from "@/hooks/storageKeys";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
// ↓ CommentMessage & Reaction types now come from the hook — single source of truth
import { useComments, CommentMessage, Reaction } from "@/hooks/useComments";
import ChatBanner from "@/components/ChatBanner";
import { FlashList } from "@shopify/flash-list";

// ─────────────────────────────────────────────
// DESIGN TOKENS
// ─────────────────────────────────────────────
const C = {
  bg: "#F8F8FA",
  surface: "#FFFFFF",
  border: "#E4E4E8",
  borderLight: "#F0F0F3",
  accent: "#F97316",
  accentMuted: "#FFF4ED",
  accentText: "#C2410C",
  accentDark: "#EA6B0A",
  text: "#111118",
  textSub: "#4B4B60",
  textMuted: "#9494A8",
  danger: "#EF4444",
  dangerMuted: "#FEF2F2",
  success: "#22C55E",
  highlight: "#FFFBEB",
  replyBar: "#F97316",
  replyBg: "#FFF7F3",
  inputBg: "#F3F4F6",
  skeletonBase: "#E8E8EC",
  skeletonShimmer: "#F4F4F8",
  reactionBg: "#F3F4F6",
  shadow: Platform.select({ ios: "#000", android: "#000", web: "#6366F1" }),
};

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────
// CommentMessage & Reaction are imported from useComments — single source of truth

type ContextMenuTarget = {
  id: string;
  isSelf: boolean;
  text: string;
  image?: string | null;
};

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
const formatTimeAgo = (timestamp: number) => {
  const now = Date.now();
  const diff = Math.floor((now - timestamp) / 1000);
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s`;
  const mins = Math.floor(diff / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d`;
  return new Date(timestamp).toLocaleDateString();
};

const formatName = (name = "") =>
  name.toLowerCase().replace(/\b\w/g, (l) => l.toUpperCase());

const getInitials = (name = "") =>
  name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || "")
    .join("");

const avatarColor = (name = "") => {
  const palette = [
    "#FDBA74", "#86EFAC", "#93C5FD", "#F9A8D4",
    "#A5B4FC", "#6EE7B7", "#FCD34D", "#F87171",
  ];
  let h = 0;
  for (let i = 0; i < name.length; i++)
    h = (h * 31 + name.charCodeAt(i)) % palette.length;
  return palette[Math.abs(h)];
};

const triggerHaptic = (type: "light" | "medium" | "success" | "error" = "light") => {
  if (Platform.OS === "web") return;
  try {
    if (type === "light") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    else if (type === "medium") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    else if (type === "success") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    else if (type === "error") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  } catch { }
};

const REACTION_EMOJI: Record<Reaction, string> = {
  heart: "❤️",
  like: "👍",
  haha: "😂",
  wow: "😮",
  sad: "😢",
};

// ─────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────

// ── Avatar ──────────────────────────────────
const Avatar = ({
  uri,
  name,
  size = 36,
}: {
  uri?: string;
  name: string;
  size?: number;
}) => {
  const bg = avatarColor(name);
  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        accessibilityLabel={`${name}'s avatar`}
      />
    );
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: bg,
        alignItems: "center",
        justifyContent: "center",
      }}
      accessible
      accessibilityLabel={`${name}'s avatar`}
    >
      <Text
        style={{
          fontSize: size * 0.38,
          fontWeight: "700",
          color: "#fff",
          letterSpacing: 0.3,
        }}
      >
        {getInitials(name) || "?"}
      </Text>
    </View>
  );
};

// ── Status Icon ──────────────────────────────
const StatusIcon = ({ status }: { status: string }) => {
  if (status === "read")
    return <Ionicons name="checkmark-done" size={13} color={C.accent} />;
  if (status === "sent")
    return <Ionicons name="checkmark-done" size={13} color={C.textMuted} />;
  if (status === "sending")
    return <Ionicons name="time-outline" size={13} color={C.textMuted} />;
  return (
    <Ionicons name="cloud-offline-outline" size={13} color={C.danger} />
  );
};

// ── Skeleton Loader ──────────────────────────
const SkeletonRow = ({ anim }: { anim: Animated.Value }) => {
  const opacity = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.4, 1],
  });
  return (
    <Animated.View style={[s.skeletonRow, { opacity }]}>
      <View style={s.skeletonAvatar} />
      <View style={{ flex: 1, gap: 8 }}>
        <View style={[s.skeletonLine, { width: "40%", height: 12 }]} />
        <View style={[s.skeletonLine, { width: "85%", height: 10 }]} />
        <View style={[s.skeletonLine, { width: "60%", height: 10 }]} />
      </View>
    </Animated.View>
  );
};

// ── Typing Indicator ─────────────────────────
const TypingIndicator = () => {
  const dot1 = useRef(new Animated.Value(0)).current;
  const dot2 = useRef(new Animated.Value(0)).current;
  const dot3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const bounce = (d: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(d, { toValue: -5, duration: 300, useNativeDriver: true }),
          Animated.timing(d, { toValue: 0, duration: 300, useNativeDriver: true }),
          Animated.delay(600),
        ])
      );
    const a1 = bounce(dot1, 0);
    const a2 = bounce(dot2, 150);
    const a3 = bounce(dot3, 300);
    a1.start(); a2.start(); a3.start();
    return () => { a1.stop(); a2.stop(); a3.stop(); };
  }, []);

  return (
    <View style={s.typingRow}>
      <View style={s.typingBubble}>
        {[dot1, dot2, dot3].map((d, i) => (
          <Animated.View
            key={i}
            style={[s.typingDot, { transform: [{ translateY: d }] }]}
          />
        ))}
      </View>
      <Text style={s.typingLabel}>Someone is typing…</Text>
    </View>
  );
};

// ── Reaction Picker ──────────────────────────
const ReactionPicker = ({
  visible,
  onSelect,
  onClose,
}: {
  visible: boolean;
  onSelect: (r: Reaction) => void;
  onClose: () => void;
}) => {
  const scale = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(scale, {
      toValue: visible ? 1 : 0,
      useNativeDriver: true,
      tension: 120,
      friction: 8,
    }).start();
  }, [visible]);

  if (!visible) return null;

  return (
    <Pressable style={s.reactionOverlay} onPress={onClose}>
      <Animated.View style={[s.reactionPicker, { transform: [{ scale }] }]}>
        {(Object.entries(REACTION_EMOJI) as [Reaction, string][]).map(
          ([key, emoji]) => (
            <TouchableOpacity
              key={key}
              style={s.reactionOption}
              onPress={() => { triggerHaptic("light"); onSelect(key); }}
              accessibilityLabel={`React with ${key}`}
            >
              <Text style={s.reactionEmoji}>{emoji}</Text>
            </TouchableOpacity>
          )
        )}
      </Animated.View>
    </Pressable>
  );
};

// ── Empty State ──────────────────────────────
const EmptyState = () => {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.08, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  return (
    <View style={s.emptyState} accessible accessibilityLabel="No comments yet">
      <Animated.View style={{ transform: [{ scale: pulse }] }}>
        <View style={s.emptyIconCircle}>
          <Ionicons name="chatbubble-ellipses-outline" size={38} color={C.accent} />
        </View>
      </Animated.View>
    </View>
  );
};

// ── Search Bar ───────────────────────────────
const SearchBar = ({
  value,
  onChange,
  onClose,
}: {
  value: string;
  onChange: (v: string) => void;
  onClose: () => void;
}) => (
  <View style={s.searchBar}>
    <Ionicons name="search-outline" size={16} color={C.textMuted} />
    <TextInput
      style={s.searchInput}
      placeholder="Search comments…"
      placeholderTextColor={C.textMuted}
      value={value}
      onChangeText={onChange}
      autoFocus
      returnKeyType="search"
      accessibilityLabel="Search comments"
    />
    <TouchableOpacity onPress={onClose}>
      <Ionicons name="close-circle" size={18} color={C.textMuted} />
    </TouchableOpacity>
  </View>
);

// ─────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────
export default function comments_flashList() {
  const [text, setText] = useState("");
  const isConnectedNET = useNetworkStatus();
  const [showModal, setShowModal] = useState(false);
  const [inputHeight, setInputHeight] = useState(40);
  const [fullImageUri, setFullImageUri] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<CommentMessage | null>(null);
  const [editingImageId, setEditingImageId] = useState<string | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [lastSentId, setLastSentId] = useState<string | null>(null);
  const [showLoader, setShowLoader] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [isTyping] = useState(false); // wire to real presence if needed
  const [contextMenu, setContextMenu] = useState<ContextMenuTarget | null>(null);
  const [reactionTarget, setReactionTarget] = useState<string | null>(null);
  const [charCount, setCharCount] = useState(0);

  const inputRef = useRef<TextInput>(null);
  const isSendingRef = useRef(false);
  const flashListRef = useRef<FlashList<CommentMessage>>(null);
  const skeletonAnim = useRef(new Animated.Value(0)).current;
  const highlightAnim = useRef<Map<string, Animated.Value>>(new Map()).current;

  const { userName, userId, userPhotoUrl } = useContext(GlobalContext);
  const STORAGE_KEY = UserStorageKeys.smartlearners_scores_db2(userId);
  const { messages, setMessages, loading, loadMore, hasMore, refresh } =
    useComments({ userId });

  useFocusEffect(
    useCallback(() => {
      if (!userId) router.replace("/");
    }, [userId])
  );
  useFocusEffect(
    useCallback(() => {
      return () => setMessages([]);
    }, [])
  );

  // ── Skeleton pulse animation ──────────────────────────────────────────────
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(skeletonAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(skeletonAnim, { toValue: 0, duration: 700, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  // ── Local storage ─────────────────────────────────────────────────────────
  const loadLocal = useCallback(async () => {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEY);
      if (data) {
        const parsed: CommentMessage[] = JSON.parse(data);
        setMessages(parsed);
        parsed.forEach((m) => {
          if (!highlightAnim.has(m.id))
            highlightAnim.set(m.id, new Animated.Value(0));
        });
      }
    } catch (err) {
      console.warn("loadLocal error:", err);
    }
  }, [highlightAnim]);

  const saveLocal = useCallback(async (msgs: CommentMessage[]) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(msgs));
    } catch (err) {
      console.warn("saveLocal error:", err);
    }
  }, []);

  useEffect(() => {
    loadLocal();
  }, [loadLocal]);

  // ── Loader: only for the initial 500ms window ─────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => setShowLoader(false), 500);
    return () => clearTimeout(t);
  }, []);

  // ── Pull-to-refresh ───────────────────────────────────────────────────────
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    triggerHaptic("light");
    try {
      await refresh?.();
    } finally {
      setIsRefreshing(false);
    }
  }, [refresh]);

  // ── Search / filter ───────────────────────────────────────────────────────
  const filteredMessages = useMemo(() => {
    if (!searchQuery.trim()) return messages;
    const q = searchQuery.toLowerCase();
    return messages.filter(
      (m) =>
        m.text?.toLowerCase().includes(q) ||
        m.user?.toLowerCase().includes(q) ||
        m.imageCaption?.toLowerCase().includes(q)
    );
  }, [messages, searchQuery]);

  // ── Scroll ────────────────────────────────────────────────────────────────
  const scrollToTop = () =>
    flashListRef.current?.scrollToOffset({ offset: 0, animated: true });

  // ── Image helpers ─────────────────────────────────────────────────────────
  const uploadImageToFirebase = async (uri: string, name: string) => {
    try {
      const storage = getStorage();
      const storageRef = ref(storage, `comments/${name}.jpg`);
      const blob = await (await fetch(uri)).blob();
      await uploadBytes(storageRef, blob);
      return await getDownloadURL(storageRef);
    } catch {
      return null;
    }
  };

  const checkImageSize = async (uri: string) => {
    try {
      return (await (await fetch(uri)).blob()).size / (1024 * 1024) <= 1;
    } catch {
      return false;
    }
  };

  const pickImage = async () => {
    const p = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!p.granted) return;
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
    });
    if (r.canceled || !r.assets?.length) return;
    const uri = r.assets[0].uri;
    if (!(await checkImageSize(uri))) { setShowModal(true); return; }
    triggerHaptic("success");
    await handleImageSend(uri);
  };

  const takePhoto = async () => {
    const p = await ImagePicker.requestCameraPermissionsAsync();
    if (!p.granted) return;
    const r = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    if (r.canceled || !r.assets?.length) return;
    const uri = r.assets[0].uri;
    if (!(await checkImageSize(uri))) { setShowModal(true); return; }
    triggerHaptic("success");
    await handleImageSend(uri);
  };

  // ── ID generator ──────────────────────────────────────────────────────────
  const generateId = () =>
    Math.random().toString(36).substring(2, 10) + Date.now().toString(36);

  // ── Send message ──────────────────────────────────────────────────────────
  const sendMessage = async () => {
    if (isSendingRef.current || !text.trim()) return;
    setInputHeight(40);
    isSendingRef.current = true;
    triggerHaptic("medium");
    Keyboard.dismiss();

    // Editing image caption
    if (editingImageId) {
      setMessages((prev) => {
        const updated = prev.map((m) =>
          m.id === editingImageId
            ? { ...m, imageCaption: text.trim(), edited: true }
            : m
        );
        saveLocal(updated);
        return updated;
      });
      setText("");
      setCharCount(0);
      setEditingImageId(null);
      isSendingRef.current = false;
      if (isConnectedNET) {
        const msgToUpdate = messages.find((m) => m.id === editingImageId);
        if (msgToUpdate) {
          await setDoc(
            doc(collection(db, "comments"), editingImageId),
            {
              ...msgToUpdate,
              imageCaption: text.trim(),
              edited: true,
              status: "sent",
              serverTime: serverTimestamp(),
            },
            { merge: true }
          );
        }
      }
      return;
    }

    const id = generateId();
    setLastSentId(id);
    const msg: CommentMessage = {
      id,
      text: text.trim(),
      user: userName || "Guest",
      email: userId || "",
      contact: "555-555-5555",
      userPhotoUrl: userPhotoUrl || "",
      image: null,
      timestamp: Date.now(),
      imageCaption: "",
      likes: 0,
      dislikes: 0,
      hearts: 0,
      reactions: {},
      myReaction: null,
      status: isConnectedNET ? "sending" : "offline",
      replyTo: replyTo
        ? {
          id: replyTo.id,
          user: replyTo.user,
          text: replyTo.text || "",
          image: replyTo.image || null,
        }
        : null,
      serverTime: Date.now(),
      edited: false,
      pinned: false,
    };

    if (!highlightAnim.has(id)) highlightAnim.set(id, new Animated.Value(0));
    setText("");
    setCharCount(0);
    setMessages((prev: any) => {
      const u = [msg, ...prev];
      saveLocal(u);
      scrollToTop();
      return u;
    });
    setReplyTo(null);

    if (isConnectedNET) {
      try {
        await setDoc(doc(collection(db, "comments"), id), {
          ...msg,
          status: "sent",
          serverTime: serverTimestamp(),
        });
        setMessages((prev) =>
          prev.map((m) => (m.id === id ? { ...m, status: "sent" } : m))
        );

        saveLocal(messages);
        await fetch(
          "https://email-service-570014654568.us-central1.run.app/push_notification",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: "Comment: " + (userName || "Guest"),
              body: msg.text || "Text comment",
              data: { screen: "chat/comments", commentId: String(msg.id) },
            }),
          }
        );
      } catch (err) {
        console.log("Send error:", err);
        triggerHaptic("error");
      }
    }
    isSendingRef.current = false;
  };

  const handleImageSend = async (uri: string) => {
    const id = generateId();
    const msg: CommentMessage = {
      id,
      text: "",
      user: userName || "Guest",
      email: userId || "",
      contact: "555-555-5555",
      userPhotoUrl: userPhotoUrl || "",
      image: uri,
      imageCaption: "",
      timestamp: Date.now(),
      likes: 0,
      dislikes: 0,
      hearts: 0,
      reactions: {},
      myReaction: null,
      serverTime: Date.now(),
      edited: false,
      pinned: false,
      status: isConnectedNET ? "sending" : "offline",
    };
    if (!highlightAnim.has(id)) highlightAnim.set(id, new Animated.Value(0));
    setMessages((prev: any) => {
      const u = [msg, ...prev];
      saveLocal(u);
      scrollToTop();
      return u;
    });
    if (isConnectedNET) {
      const url = await uploadImageToFirebase(uri, id);
      if (!url) return;
      await setDoc(doc(collection(db, "comments"), id), {
        ...msg,
        image: url,
        status: "sent",
        serverTime: serverTimestamp(),
      });
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, image: url, status: "sent" } : m))
      );
      saveLocal(messages);
    }
  };

  // ── Resend offline ────────────────────────────────────────────────────────
  const resendPendingMessages = useCallback(async () => {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEY);
      if (!data) return;
      const all: CommentMessage[] = JSON.parse(data);
      const pending = all.filter((m) => m.status === "offline");
      if (!pending.length) return;
      for (const m of pending) {
        try {
          let img = m.image;
          if (m.image && !m.image.startsWith("http"))
            img = await uploadImageToFirebase(m.image, m.id);
          await setDoc(doc(collection(db, "comments"), m.id), {
            ...m,
            image: img,
            status: "sent",
            serverTime: serverTimestamp(),
          });
          const updated: any = all.map((x) =>
            x.id === m.id ? { ...x, image: img, status: "sent" } : x
          );
          await saveLocal(updated);
          setMessages(updated);
        } catch { }
      }
    } catch (err) {
      console.warn("resend error:", err);
    }
  }, []);

  useNetworkStatus(resendPendingMessages);

  // ── Reactions ─────────────────────────────────────────────────────────────
  const handleReaction = (id: string, reaction: Reaction) => {
    triggerHaptic("light");
    setReactionTarget(null);
    setMessages((prev) => {
      const updated = prev.map((m) => {
        if (m.id !== id) return m;
        const prev_reaction = m.myReaction;
        const reactions = { ...(m.reactions || {}) };
        // Remove old reaction
        if (prev_reaction) {
          reactions[prev_reaction] = Math.max(0, (reactions[prev_reaction] || 1) - 1);
        }
        // Toggle: if same reaction, clear it
        if (prev_reaction === reaction) {
          return { ...m, myReaction: null, reactions };
        }
        reactions[reaction] = (reactions[reaction] || 0) + 1;
        return { ...m, myReaction: reaction, reactions };
      });
      saveLocal(updated);
      return updated;
    });
    if (isConnectedNET) {
      try {
        setDoc(
          doc(collection(db, "comments"), id),
          { [`reactions.${reaction}`]: increment(1) },
          { merge: true }
        );
      } catch { }
    }
  };

  // Legacy heart shortcut
  const handleHeart = (id: string) => handleReaction(id, "heart");

  // ── Delete ────────────────────────────────────────────────────────────────
  const confirmDelete = (id: string) => {
    triggerHaptic("medium");
    setDeleteTargetId(id);
    setContextMenu(null);
  };

  const handleDelete = async (id: string) => {
    triggerHaptic("error");
    setMessages((prev) => {
      const u = prev.filter((m) => m.id !== id);
      saveLocal(u);
      return u;
    });
    if (isConnectedNET) {
      try {
        await deleteDoc(doc(collection(db, "comments"), id));
      } catch { }
    }
  };

  // ── Long-press context menu ───────────────────────────────────────────────
  const openContextMenu = (item: CommentMessage) => {
    triggerHaptic("medium");
    setContextMenu({
      id: item.id,
      isSelf: item.user === userName,
      text: item.text,
      image: item.image,
    });
  };

  // ── Copy text ─────────────────────────────────────────────────────────────
  const copyText = (text: string) => {
    if (Platform.OS === "web") {
      navigator.clipboard?.writeText(text).catch(() => { });
    } else {
      // Use Clipboard API if available in your RN version
      try {
        const Clipboard = require("@react-native-clipboard/clipboard").default;
        Clipboard.setString(text);
      } catch { }
    }
    setContextMenu(null);
    triggerHaptic("success");
  };

  // ── Highlight jump ────────────────────────────────────────────────────────
  const jumpToMessage = (targetId: string) => {
    const index = messages.findIndex((m) => m.id === targetId);
    if (index !== -1) {
      flashListRef.current?.scrollToIndex({ index, animated: true });
      const a = highlightAnim.get(targetId);
      if (a) {
        a.setValue(1);
        Animated.timing(a, {
          toValue: 0,
          duration: 1500,
          useNativeDriver: false,
        }).start();
      }
    }
  };

  // ─────────────────────────────────────────────
  // LOADING STATE — skeleton only for initial 500ms
  // ─────────────────────────────────────────────
  if (showLoader) {
    return (
      <ReusableScreen>
        <View style={{ flex: 1, backgroundColor: C.surface }}>
          <View style={s.header}>
            <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
              <Ionicons name="arrow-back" size={20} color={C.text} />
            </TouchableOpacity>
            <Text style={s.headerTitle}>Comments</Text>
            <View style={{ width: 36 }} />
          </View>
          <View style={s.headerDivider} />
          {[...Array(5)].map((_, i) => (
            <SkeletonRow key={i} anim={skeletonAnim} />
          ))}
        </View>
      </ReusableScreen>
    );
  }

  // ─────────────────────────────────────────────
  // RENDER ITEM
  // ─────────────────────────────────────────────
  const renderItem = ({ item }: { item: CommentMessage }) => {
    const isSelf = item.user === userName;

    if (!highlightAnim.has(item.id))
      highlightAnim.set(item.id, new Animated.Value(0));
    const animValue = highlightAnim.get(item.id)!;

    const highlightStyle: Animated.WithAnimatedObject<ViewStyle> = {
      backgroundColor: animValue.interpolate({
        inputRange: [0, 1],
        outputRange: ["transparent", C.highlight],
      }) as any,
    };

    // Aggregate visible reactions
    const visibleReactions = Object.entries(item.reactions || {}).filter(
      ([, count]) => (count ?? 0) > 0
    ) as [Reaction, number][];

    return (
      <AnimatedMessage shouldAnimate={item.id === lastSentId}>
        <Animated.View style={[s.row, highlightStyle]}>
          {/* Pinned indicator */}
          {item.pinned && (
            <View style={s.pinnedBadge}>
              <Ionicons name="pin" size={10} color={C.accent} />
              <Text style={s.pinnedText}>Pinned</Text>
            </View>
          )}

          {/* Left — avatar + thread line */}
          <View style={s.avatarCol}>
            <Avatar uri={item.userPhotoUrl} name={item.user} size={36} />
            <View style={s.threadLine} />
          </View>

          {/* Right — content */}
          <Pressable
            style={s.bodyCol}
            onLongPress={() => openContextMenu(item)}
            delayLongPress={350}
            accessibilityHint="Long press for options"
          >
            {/* Name · time · status */}
            <View style={s.metaRow}>
              <Text style={s.userName} numberOfLines={1}>
                {item.user ? formatName(item.user) : "Unknown"}
              </Text>
              {isSelf && (
                <View style={s.selfBadge}>
                  <Text style={s.selfBadgeText}>you</Text>
                </View>
              )}
              {item.edited && (
                <Text style={s.editedTag}>edited</Text>
              )}
              <Text style={s.metaTime}>
                {formatTimeAgo(item.serverTime || item.timestamp)}
              </Text>
              <StatusIcon status={item.status} />
            </View>

            {/* Reply quote */}
            {item.replyTo && (
              <TouchableOpacity
                activeOpacity={0.6}
                onPress={() => jumpToMessage(item.replyTo!.id)}
                accessibilityLabel={`Reply to ${item.replyTo.user}`}
              >
                <View style={s.quoteBlock}>
                  <View style={s.quoteBar} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.quoteUser} numberOfLines={1}>
                      {formatName(item.replyTo.user)}
                    </Text>
                    <Text style={s.quoteText} numberOfLines={1}>
                      {item.replyTo.image ? "📷 Photo" : item.replyTo.text}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            )}

            {/* Image attachment */}
            {item.image && (
              <View style={s.imageWrapper}>
                <TouchableOpacity
                  activeOpacity={0.92}
                  onPress={() => setFullImageUri(item.image!)}
                  accessibilityLabel="View full image"
                >
                  <Image
                    source={require("@/assets/images/image-place-holder.png")}
                    style={{
                      width: "100%",
                      borderRadius: 12,
                      maxWidth: 280,
                      height: 160,
                      position: "absolute",
                    }}
                    resizeMode="cover"
                  />
                  <Image
                    source={{ uri: item.image }}
                    style={s.attachedImage}
                    resizeMode="cover"
                  />
                </TouchableOpacity>
                {isSelf && (
                  <TouchableOpacity
                    style={s.editImageBtn}
                    onPress={() => {
                      setEditingImageId(item.id);
                      setText(item.imageCaption || "");
                      setCharCount((item.imageCaption || "").length);
                      inputRef.current?.focus();
                    }}
                    accessibilityLabel="Edit caption"
                  >
                    <Ionicons name="pencil" size={12} color={C.surface} />
                    <Text style={s.editImageBtnText}>Edit caption</Text>
                  </TouchableOpacity>
                )}
                {!!item.imageCaption && (
                  <Text style={s.caption}>{item.imageCaption}</Text>
                )}
              </View>
            )}

            {/* Text body */}
            {!!item.text && (
              <Text
                style={s.msgText}
                selectable={Platform.OS === "web"}
                accessibilityLabel={item.text}
              >
                {item.text}
              </Text>
            )}

            {/* Reaction summary */}
            {visibleReactions.length > 0 && (
              <View style={s.reactionSummaryRow}>
                {visibleReactions.map(([key, count]) => (
                  <TouchableOpacity
                    key={key}
                    style={[
                      s.reactionChip,
                      item.myReaction === key && s.reactionChipActive,
                    ]}
                    onPress={() => handleReaction(item.id, key)}
                    accessibilityLabel={`${count} ${key} reaction`}
                  >
                    <Text style={s.reactionChipEmoji}>{REACTION_EMOJI[key]}</Text>
                    <Text style={s.reactionChipCount}>{count}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Actions */}
            <View style={s.actionsRow}>
              <TouchableOpacity
                style={s.actionPill}
                onPress={() => setReactionTarget(item.id)}
                accessibilityLabel="React to message"
              >
                <Text style={{ fontSize: 13 }}>
                  {item.myReaction ? REACTION_EMOJI[item.myReaction] : <Ionicons
                    name="heart"
                    size={17}
                    color={C.textMuted}
                  />}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={s.actionPill}
                onPress={() => {
                  setReplyTo(item);
                  inputRef.current?.focus();
                  triggerHaptic("light");
                }}
                accessibilityLabel="Reply to comment"
              >
                <Ionicons
                  name="return-down-forward-outline"
                  size={14}
                  color={C.textMuted}
                />
                <Text style={s.actionPillText}>Reply</Text>
              </TouchableOpacity>

              {isSelf && (
                <TouchableOpacity
                  style={s.actionPill}
                  onPress={() => confirmDelete(item.id)}
                  accessibilityLabel="Delete comment"
                >
                  <Ionicons name="trash-outline" size={14} color="#000" />
                </TouchableOpacity>
              )}

              {/* Offline retry badge */}
              {item.status === "offline" && (
                <TouchableOpacity
                  style={s.retryBadge}
                  onPress={resendPendingMessages}
                  accessibilityLabel="Retry sending"
                >
                  <Ionicons name="refresh-outline" size={12} color="#fff" />
                  <Text style={s.retryBadgeText}>Retry</Text>
                </TouchableOpacity>
              )}
            </View>
          </Pressable>
        </Animated.View>
      </AnimatedMessage>
    );
  };

  const keyExtractor = (item: CommentMessage) => item.id;

  // ─────────────────────────────────────────────
  // UI
  // ─────────────────────────────────────────────
  return (
    <ReusableScreen>
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: C.surface }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 20}
      >
        <ChatBanner />

        {/* Offline banner */}
        {!isConnectedNET && (
          <View style={s.offlineBanner}>
            <Ionicons name="cloud-offline-outline" size={14} color="#fff" />
            <Text style={s.offlineText}>
              You're offline — messages will send when reconnected
            </Text>
          </View>
        )}

        {/* Header */}
        <View style={s.header}>
          <TouchableOpacity
            style={s.backBtn}
            onPress={() => router.back()}
            accessibilityLabel="Go back"
          >
            <Ionicons name="arrow-back" size={20} color={C.text} />
          </TouchableOpacity>

          {showSearch ? (
            <SearchBar
              value={searchQuery}
              onChange={setSearchQuery}
              onClose={() => { setShowSearch(false); setSearchQuery(""); }}
            />
          ) : (
            <>
              <Text style={s.headerTitle}>Comments</Text>
              <View style={{ flexDirection: "row", gap: 4 }}>
                <TouchableOpacity
                  style={s.headerIconBtn}
                  onPress={() => setShowSearch(true)}
                  accessibilityLabel="Search comments"
                >
                  <Ionicons name="search-outline" size={18} color={C.text} />
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
        <View style={s.headerDivider} />

        {/* Search result count */}
        {showSearch && searchQuery.trim() !== "" && (
          <View style={s.searchResultCount}>
            <Text style={s.searchResultText}>
              {filteredMessages.length} result{filteredMessages.length !== 1 ? "s" : ""}
            </Text>
          </View>
        )}

        {/* Typing indicator */}
        {isTyping && <TypingIndicator />}

        {/* Comment list */}
        <FlashList
          ref={flashListRef}
          inverted
          data={filteredMessages}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          estimatedItemSize={110}
          drawDistance={400}
          contentContainerStyle={s.listContent}
          maintainVisibleContentPosition={{
            minIndexForVisible: 1,
            autoscrollToTopThreshold: 20,
          }}
          onEndReached={() => { if (hasMore && !loading) loadMore(); }}
          onEndReachedThreshold={0.5}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor={C.accent}
              colors={[C.accent]}
            />
          }
          ListEmptyComponent={<EmptyState />}
          ListFooterComponent={
            hasMore && loading ? (
              <ActivityIndicator
                style={{ paddingVertical: 16 }}
                size="small"
                color={C.accent}
              />
            ) : null
          }
        />

        {/* Context menu */}
        {contextMenu && (
          <Pressable style={s.overlay} onPress={() => setContextMenu(null)}>
            <View style={s.contextMenu}>
              <Text style={s.contextMenuTitle}>Options</Text>
              {contextMenu.text ? (
                <TouchableOpacity
                  style={s.contextMenuItem}
                  onPress={() => copyText(contextMenu.text)}
                >
                  <Ionicons name="copy-outline" size={18} color={C.text} />
                  <Text style={s.contextMenuItemText}>Copy text</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                style={s.contextMenuItem}
                onPress={() => {
                  const target = messages.find((m) => m.id === contextMenu.id);
                  if (target) {
                    setReplyTo(target);
                    inputRef.current?.focus();
                  }
                  setContextMenu(null);
                }}
              >
                <Ionicons name="return-down-forward-outline" size={18} color={C.text} />
                <Text style={s.contextMenuItemText}>Reply</Text>
              </TouchableOpacity>
              {contextMenu.isSelf && (
                <TouchableOpacity
                  style={[s.contextMenuItem, s.contextMenuDanger]}
                  onPress={() => confirmDelete(contextMenu.id)}
                >
                  <Ionicons name="trash-outline" size={18} color={C.danger} />
                  <Text style={[s.contextMenuItemText, { color: C.danger }]}>
                    Delete
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </Pressable>
        )}

        {/* Delete confirmation */}
        {deleteTargetId && (
          <View style={s.overlay}>
            <View style={s.confirmBox}>
              <View style={s.confirmIconCircle}>
                <Ionicons name="warning-outline" size={26} color={C.danger} />
              </View>
              <Text style={s.confirmTitle}>Delete message?</Text>
              <Text style={s.confirmSub}>This cannot be undone.</Text>
              <View style={s.confirmBtns}>
                <TouchableOpacity
                  style={s.cancelBtn}
                  onPress={() => setDeleteTargetId(null)}
                  accessibilityLabel="Cancel delete"
                >
                  <Text style={s.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={s.deleteConfirmBtn}
                  onPress={() => {
                    handleDelete(deleteTargetId);
                    setDeleteTargetId(null);
                  }}
                  accessibilityLabel="Confirm delete"
                >
                  <Text style={s.deleteConfirmBtnText}>Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        {/* Image too large modal */}
        <Modal
          isVisible={showModal}
          animationIn="fadeIn"
          animationOut="fadeOut"
          onBackdropPress={() => setShowModal(false)}
          backdropOpacity={0.4}
          style={{ margin: 0, justifyContent: "center", alignItems: "center" }}
        >
          <View style={s.modalBox}>
            <Ionicons
              name="image-outline"
              size={32}
              color={C.accent}
              style={{ marginBottom: 8 }}
            />
            <Text style={s.modalTitle}>Image too large</Text>
            <Text style={s.modalSub}>Please choose an image under 1 MB.</Text>
            <TouchableOpacity
              style={s.modalOkBtn}
              onPress={() => setShowModal(false)}
              accessibilityLabel="Dismiss"
            >
              <Text style={s.modalOkText}>Got it</Text>
            </TouchableOpacity>
          </View>
        </Modal>

        {/* Reaction picker */}
        <ReactionPicker
          visible={!!reactionTarget}
          onSelect={(r) => reactionTarget && handleReaction(reactionTarget, r)}
          onClose={() => setReactionTarget(null)}
        />

        {/* Reply strip */}
        {replyTo && (
          <View style={s.replyStrip}>
            <View style={s.replyStripBar} />
            <View style={{ flex: 1 }}>
              <Text style={s.replyStripLabel}>
                Replying to{" "}
                <Text style={{ fontWeight: "700", color: C.accentText }}>
                  {formatName(replyTo.user)}
                </Text>
              </Text>
              <Text style={s.replyStripSnippet} numberOfLines={1}>
                {replyTo.image ? "📷 Photo" : replyTo.text}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => setReplyTo(null)}
              style={{ padding: 4 }}
              accessibilityLabel="Cancel reply"
            >
              <Ionicons name="close" size={18} color={C.textMuted} />
            </TouchableOpacity>
          </View>
        )}

        {/* Caption editing indicator */}
        {editingImageId && (
          <View style={s.editingStrip}>
            <Ionicons name="pencil-outline" size={14} color={C.accent} />
            <Text style={s.editingStripText}>Editing caption</Text>
            <TouchableOpacity
              onPress={() => { setEditingImageId(null); setText(""); setCharCount(0); }}
              style={{ marginLeft: "auto", padding: 4 }}
            >
              <Ionicons name="close" size={16} color={C.textMuted} />
            </TouchableOpacity>
          </View>
        )}

        {/* Input bar */}
        <View style={s.inputBar}>
          <TouchableOpacity
            style={s.inputIconBtn}
            onPress={takePhoto}
            accessibilityLabel="Take photo"
          >
            <Ionicons name="camera-outline" size={22} color={C.textSub} />
          </TouchableOpacity>
          <TouchableOpacity
            style={s.inputIconBtn}
            onPress={pickImage}
            accessibilityLabel="Choose image"
          >
            <Ionicons name="image-outline" size={22} color={C.textSub} />
          </TouchableOpacity>
          <View style={s.textInputWrapper}>
            <TextInput
              ref={inputRef}
              style={[s.textInput, { height: Math.max(38, inputHeight) }]}
              placeholder={
                editingImageId ? "Add a caption…" : "Write a comment…"
              }
              placeholderTextColor={C.textMuted}
              value={text}
              onChangeText={(v) => { setText(v); setCharCount(v.length); }}
              maxLength={500}
              multiline
              onContentSizeChange={(e) =>
                setInputHeight(e.nativeEvent.contentSize.height)
              }
              accessibilityLabel="Comment input"
              returnKeyType="default"
            />
            {/* Char counter — shows at 80% of limit */}
            {charCount > 400 && (
              <Text
                style={[
                  s.charCounter,
                  charCount > 480 && { color: C.danger },
                ]}
              >
                {500 - charCount}
              </Text>
            )}
          </View>
          <TouchableOpacity
            style={[s.sendBtn, !text.trim() && s.sendBtnDisabled]}
            onPress={sendMessage}
            disabled={!text.trim()}
            accessibilityLabel="Send comment"
          >
            <Ionicons name="send" size={17} color={C.surface} />
          </TouchableOpacity>
        </View>

        {/* Full-screen image viewer */}
        <Modal
          isVisible={!!fullImageUri}
          onBackdropPress={() => setFullImageUri(null)}
          animationIn="fadeIn"
          animationOut="fadeOut"
          backdropOpacity={1}
          backdropColor="#000"
          style={{ margin: 0 }}
          statusBarTranslucent
        >
          <TouchableOpacity
            style={s.fullImageContainer}
            activeOpacity={1}
            onPress={() => setFullImageUri(null)}
            accessibilityLabel="Close image viewer"
          >
            <Image
              source={{ uri: fullImageUri || "" }}
              style={s.fullImage}
              resizeMode="contain"
            />
            <TouchableOpacity
              style={s.fullImageClose}
              onPress={() => setFullImageUri(null)}
              accessibilityLabel="Close"
            >
              <Ionicons name="close" size={22} color="#fff" />
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      </KeyboardAvoidingView>
    </ReusableScreen>
  );
}

// ─────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────
const s = StyleSheet.create({
  // ── List ──────────────────────────────────────
  listContent: { paddingBottom: 8 },

  // ── Header ────────────────────────────────────
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: C.surface,
    minHeight: 52,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: C.text,
    letterSpacing: 0.1,
    flex: 1,
    textAlign: "center",
  },
  headerDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: C.border,
  },
  headerIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: C.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: C.bg,
    alignItems: "center",
    justifyContent: "center",
  },

  // ── Offline banner ────────────────────────────
  offlineBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#374151",
    paddingHorizontal: 14,
    paddingVertical: 7,
    gap: 7,
  },
  offlineText: { color: "#fff", fontSize: 12, fontWeight: "500", flex: 1 },

  // ── Search ────────────────────────────────────
  searchBar: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.inputBg,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 6,
    marginHorizontal: 4,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: C.text,
    ...(Platform.OS === "web" && { outlineStyle: "none" } as any),
  },
  searchResultCount: {
    paddingHorizontal: 16,
    paddingVertical: 5,
    backgroundColor: C.accentMuted,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#FED7AA",
  },
  searchResultText: {
    fontSize: 13,
    color: C.accentText,
    fontWeight: "600",
  },

  // ── Skeleton ──────────────────────────────────
  skeletonRow: {
    flexDirection: "row",
    padding: 16,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.borderLight,
  },
  skeletonAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: C.skeletonBase,
  },
  skeletonLine: {
    borderRadius: 6,
    backgroundColor: C.skeletonBase,
  },

  // ── Typing indicator ──────────────────────────
  typingRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 6,
    gap: 8,
  },
  typingBubble: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.reactionBg,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 4,
  },
  typingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: C.textMuted,
  },
  typingLabel: { fontSize: 12, color: C.textMuted, fontStyle: "italic" },

  // ── Empty state ───────────────────────────────
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 80,
    gap: 10,
  },
  emptyIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: C.accentMuted,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: C.text,
    letterSpacing: 0.1,
  },
  emptySub: {
    fontSize: 14,
    color: C.textMuted,
    textAlign: "center",
    paddingHorizontal: 40,
    lineHeight: 20,
  },

  // ── Pinned badge ──────────────────────────────
  pinnedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 10,
    paddingBottom: 2,
    opacity: 0.7,
  },
  pinnedText: { fontSize: 11, color: C.accent, fontWeight: "600" },

  // ── Message row ───────────────────────────────
  row: {
    flexDirection: "row",
    paddingRight: 16,
    paddingLeft: 10,
    paddingTop: 14,
    paddingBottom: 4,
    backgroundColor: C.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.borderLight,
  },
  avatarCol: { alignItems: "center", marginRight: 12, paddingTop: 2 },
  threadLine: {
    flex: 1,
    width: 1.5,
    backgroundColor: C.borderLight,
    marginTop: 6,
    borderRadius: 1,
    minHeight: 16,
  },
  bodyCol: { flex: 1, paddingBottom: 10 },

  // ── Meta row ──────────────────────────────────
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 5,
    flexWrap: "wrap",
  },
  userName: {
    fontSize: 15,
    fontWeight: "700",
    color: C.text,
    flexShrink: 1,
  },
  selfBadge: {
    backgroundColor: C.accentMuted,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  selfBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: C.accentText,
    letterSpacing: 0.3,
  },
  editedTag: {
    fontSize: 11,
    color: C.textMuted,
    fontStyle: "italic",
  },
  metaTime: { fontSize: 12, color: C.textMuted, marginLeft: "auto" },

  // ── Quote block ───────────────────────────────
  quoteBlock: {
    flexDirection: "row",
    backgroundColor: C.bg,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginBottom: 6,
    gap: 8,
    overflow: "hidden",
  },
  quoteBar: { width: 3, borderRadius: 2, backgroundColor: C.accent, alignSelf: "stretch" },
  quoteUser: { fontSize: 12, fontWeight: "700", color: C.accent, marginBottom: 1 },
  quoteText: { fontSize: 13, color: C.textSub, flexShrink: 1 },

  // ── Image ─────────────────────────────────────
  imageWrapper: { marginBottom: 8, marginTop: 2 },
  attachedImage: {
    width: "100%",
    maxWidth: 280,
    height: 160,
    borderRadius: 10,
    backgroundColor: C.bg,
  },
  editImageBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
    alignSelf: "flex-start",
    backgroundColor: C.textSub,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  editImageBtnText: { fontSize: 12, color: C.surface, fontWeight: "600" },
  caption: { fontSize: 13, color: C.textSub, marginTop: 4, fontStyle: "italic" },

  // ── Message text ──────────────────────────────
  msgText: { fontSize: 15, color: C.text, lineHeight: 22, flexShrink: 1 },

  // ── Reactions ─────────────────────────────────
  reactionSummaryRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 5,
    marginTop: 6,
    marginBottom: 2,
  },
  reactionChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: C.reactionBg,
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
  },
  reactionChipActive: {
    backgroundColor: C.accentMuted,
    borderColor: C.accent,
  },
  reactionChipEmoji: { fontSize: 13 },
  reactionChipCount: { fontSize: 12, color: C.textSub, fontWeight: "600" },

  // ── Actions row ───────────────────────────────
  actionsRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
    gap: 6,
    flexWrap: "wrap",
  },
  actionPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    backgroundColor: '#eee',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
  },
  actionPillText: { fontSize: 12, color: "#000", fontWeight: "600" },

  // ── Retry badge ───────────────────────────────
  retryBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: C.danger,
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  retryBadgeText: { fontSize: 11, color: "#fff", fontWeight: "700" },

  // ── Reaction picker ───────────────────────────
  reactionOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 998,
    justifyContent: "center",
    alignItems: "center",
  },
  reactionPicker: {
    flexDirection: "row",
    backgroundColor: C.surface,
    borderRadius: 40,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
      android: { elevation: 8 },
      web: { boxShadow: "0 4px 20px rgba(0,0,0,0.15)" },
    }),
  },
  reactionOption: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  reactionEmoji: { fontSize: 24 },

  // ── Context menu ──────────────────────────────
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 999,
  },
  contextMenu: {
    backgroundColor: C.surface,
    borderRadius: 16,
    paddingVertical: 8,
    width: "75%",
    maxWidth: 300,
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 20, shadowOffset: { width: 0, height: 8 } },
      android: { elevation: 10 },
      web: { boxShadow: "0 8px 30px rgba(0,0,0,0.12)" },
    }),
  },
  contextMenuTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: C.textMuted,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  contextMenuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  contextMenuDanger: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.borderLight,
  },
  contextMenuItemText: { fontSize: 15, color: C.text, fontWeight: "500" },

  // ── Delete confirm ────────────────────────────
  confirmBox: {
    backgroundColor: C.surface,
    borderRadius: 20,
    paddingVertical: 28,
    paddingHorizontal: 28,
    width: "78%",
    maxWidth: 340,
    alignItems: "center",
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 20, shadowOffset: { width: 0, height: 8 } },
      android: { elevation: 10 },
      web: { boxShadow: "0 8px 30px rgba(0,0,0,0.12)" },
    }),
  },
  confirmIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: C.dangerMuted,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  confirmTitle: { fontSize: 17, fontWeight: "700", color: C.text, marginBottom: 4 },
  confirmSub: { fontSize: 14, color: C.textMuted, marginBottom: 24 },
  confirmBtns: { flexDirection: "row", gap: 10, width: "100%" },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: C.bg,
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
  },
  cancelBtnText: { fontSize: 15, fontWeight: "600", color: C.text },
  deleteConfirmBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: C.danger,
    alignItems: "center",
  },
  deleteConfirmBtnText: { fontSize: 15, fontWeight: "600", color: "#fff" },

  // ── Modal ─────────────────────────────────────
  modalBox: {
    backgroundColor: C.surface,
    borderRadius: 20,
    paddingVertical: 32,
    paddingHorizontal: 28,
    width: "80%",
    maxWidth: 340,
    alignItems: "center",
  },
  modalTitle: { fontSize: 18, fontWeight: "700", color: C.text, marginBottom: 6 },
  modalSub: {
    fontSize: 14,
    color: C.textMuted,
    textAlign: "center",
    marginBottom: 24,
    lineHeight: 20,
  },
  modalOkBtn: {
    backgroundColor: C.accent,
    paddingVertical: 12,
    paddingHorizontal: 36,
    borderRadius: 12,
  },
  modalOkText: { fontSize: 15, fontWeight: "700", color: "#fff" },

  // ── Reply strip ───────────────────────────────
  replyStrip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.replyBg,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#FED7AA",
    gap: 10,
  },
  replyStripBar: { width: 3, borderRadius: 2, backgroundColor: C.replyBar, alignSelf: "stretch" },
  replyStripLabel: { fontSize: 12, color: C.textSub, marginBottom: 1 },
  replyStripSnippet: { fontSize: 13, color: C.text },

  // ── Caption editing strip ─────────────────────
  editingStrip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.accentMuted,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#FED7AA",
    gap: 8,
  },
  editingStripText: { fontSize: 13, color: C.accentText, fontWeight: "600" },

  // ── Input bar ─────────────────────────────────
  inputBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: C.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.border,
    gap: 6,
  },
  inputIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.bg,
  },
  textInputWrapper: {
    flex: 1,
    position: "relative",
  },
  textInput: {
    flex: 1,
    backgroundColor: C.inputBg,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 9,
    fontSize: 15,
    color: C.text,
    maxHeight: 100,
    ...(Platform.OS === "web" && { outlineStyle: "none", outlineWidth: 0, boxShadow: "none" } as any),
  },
  charCounter: {
    position: "absolute",
    right: 8,
    bottom: 4,
    fontSize: 11,
    color: C.textMuted,
    fontWeight: "600",
    pointerEvents: "none",
  } as any,
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: C.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtnDisabled: { backgroundColor: "#FDBA74" },

  // ── Full image viewer ─────────────────────────
  fullImageContainer: {
    flex: 1,
    backgroundColor: "#000",
    justifyContent: "center",
    alignItems: "center",
  },
  fullImage: { width: "100%", height: "100%" },
  fullImageClose: {
    position: "absolute",
    top: Platform.OS === "ios" ? 56 : 36,
    right: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
});
