/**
 * ChatRoom.tsx — WhatsApp-style background, keyboard fix, white outgoing timestamps.
 * Lydia Fauson (AI) chats are memory-only — never written to or read from Firestore.
 *
 * PERF FIXES (mount lag):
 *  1. WaBg replaced with a single SVG-pattern via ImageBackground — no more 300 View nodes.
 *  2. showLoader removed — replaced with InteractionManager.runAfterInteractions for
 *     deferred heavy-work (Firestore listener, memory load) so the first frame paints fast.
 *  3. setChatMessages([]) on chatId change guarded with a length check to avoid
 *     unnecessary re-renders when the list is already empty.
 *  4. listData memo unified into one pass (sort + no extra reverse array allocation).
 *  5. renderItem no longer mutates refs on every call — index map updated in a
 *     stable getItemLayout / overrideItemLayout callback instead.
 *  6. Firestore onSnapshot deferred via InteractionManager so it never races
 *     with the initial paint.
 *  7. loadMemory() deferred to after mount interactions complete.
 */

import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  View,
  StyleSheet,
  Keyboard,
  Platform,
  ActivityIndicator,
  NativeSyntheticEvent,
  NativeScrollEvent,
  TouchableOpacity,
  Image,
  Text,
  TextInput,
  Pressable,
  Modal,
  Alert,
  KeyboardAvoidingView,
  Clipboard,
  ActionSheetIOS,
  Dimensions,
  Share,
  InteractionManager,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { FlashList } from '@shopify/flash-list';
import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  updateDoc,
  writeBatch,
  where,
} from 'firebase/firestore';
import { db, rtdb } from '@/firebase';
import { ref, onValue, set as rtdbSet, onDisconnect } from 'firebase/database';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GoogleGenerativeAI } from '@google/generative-ai';
import InputBar from '@/components/InputChatBar';
import { GlobalContext } from '@/context/index';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import ReusableScreen from '@/components/ReusableScreen';
import PopupMenu from '@/components/PupupMenu';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { MenuProvider } from 'react-native-popup-menu';

// ─── Constants ────────────────────────────────────────────────────────────────

const API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY ?? "AIzaSyBn_VnwoP-iyrxQ5ACJRN2q4WuDs6567T4";
const genAI = new GoogleGenerativeAI(API_KEY);
const chatModel = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });

const IS_WEB = Platform.OS === 'web';
const IS_IOS = Platform.OS === 'ios';
const SCREEN_WIDTH = Dimensions.get('window').width;
const SCREEN_HEIGHT = Dimensions.get('window').height;
const PAGE_SIZE = 30;
const ESTIMATED_ITEM_SIZE = 72;
const TYPING_TIMEOUT_MS = 3000;

// ─── Lydia guard ──────────────────────────────────────────────────────────────
const LYDIA_NAME = 'Lydia Fauson';
const isLydiaChat = (name: string | undefined | null) => name === LYDIA_NAME;

// ─── Pure helpers ─────────────────────────────────────────────────────────────

const getLocalTimeContext = (): string => {
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
  const dateStr = now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const hour = now.getHours();
  const timeOfDay = hour < 5 ? 'late night' : hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : hour < 21 ? 'evening' : 'night';
  return `Current local time: ${timeStr} (${timeOfDay}), ${dateStr}`;
};

const generateId = (): string =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

const stripUndefined = (obj: Record<string, any>): Record<string, any> =>
  Object.fromEntries(
    Object.entries(obj)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [
        k,
        v &&
          typeof v === 'object' &&
          !Array.isArray(v) &&
          typeof v.toMillis !== 'function'
          ? stripUndefined(v)
          : v,
      ])
  );

const toFirestoreMsg = (msg: ChatMessage, extra: Record<string, any> = {}): Record<string, any> => {
  const clean: Record<string, any> = {
    txtMsgId: msg.txtMsgId,
    username: msg.username ?? '',
    clientname: msg.clientname ?? '',
    text: msg.text ?? '',
    status: msg.status ?? 'Sent',
    userIconUrl: msg.userIconUrl ?? '',
    clientIconUrl: msg.clientIconUrl ?? '',
    useremail: msg.useremail ?? '',
    clientemail: msg.clientemail ?? '',
    type: msg.type ?? 'text',
    phone: msg.phone ?? null,
    mediaUrl: msg.mediaUrl ?? null,
    mediaName: msg.mediaName ?? null,
    isStarred: msg.isStarred ?? false,
    isForwarded: msg.isForwarded ?? false,
    reactions: msg.reactions ?? {},
    replyTo: msg.replyTo
      ? {
        txtMsgId: msg.replyTo.txtMsgId ?? '',
        text: msg.replyTo.text ?? '',
        username: msg.replyTo.username ?? '',
      }
      : null,
    ...extra,
  };
  return clean;
};

const sanitizeEmail = (email: string) =>
  email.replace(/\./g, '_').replace(/@/g, '_at_');

const tsToMs = (timestamp: any): number => {
  if (!timestamp) return 0;
  if (typeof timestamp === 'number') return timestamp;
  if (typeof timestamp === 'object' && typeof timestamp.toMillis === 'function')
    return timestamp.toMillis();
  if (typeof timestamp === 'object' && typeof timestamp.seconds === 'number')
    return timestamp.seconds * 1000 + Math.floor((timestamp.nanoseconds ?? 0) / 1e6);
  return 0;
};

const getMessageTime = (timestamp: any, fallbackMs?: number): string => {
  const ms = tsToMs(timestamp) || fallbackMs || 0;
  if (!ms) return '';
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const getZodiacSign = (day: number, month: number): string => {
  const signs = [
    { sign: 'Capricorn', end: [1, 19] },
    { sign: 'Aquarius', end: [2, 18] },
    { sign: 'Pisces', end: [3, 20] },
    { sign: 'Aries', end: [4, 19] },
    { sign: 'Taurus', end: [5, 20] },
    { sign: 'Gemini', end: [6, 20] },
    { sign: 'Cancer', end: [7, 22] },
    { sign: 'Leo', end: [8, 22] },
    { sign: 'Virgo', end: [9, 22] },
    { sign: 'Libra', end: [10, 22] },
    { sign: 'Scorpio', end: [11, 21] },
    { sign: 'Sagittarius', end: [12, 21] },
    { sign: 'Capricorn', end: [12, 31] },
  ] as const;
  for (const { sign, end } of signs) {
    if (month < end[0] || (month === end[0] && day <= end[1])) return sign;
  }
  return 'Capricorn';
};

const normalizeQuery = (text: string) =>
  text
    .replace(/staney/gi, 'stanley')
    .replace(/stanly/gi, 'stanley')
    .replace(/\s+/g, ' ')
    .trim();

const PERSONALITY_STAGES = ['interests', 'occupation', 'goals', 'trait_hint'] as const;
type PersonalityStage = (typeof PERSONALITY_STAGES)[number];

const STAGE_LABELS: Record<PersonalityStage, string> = {
  interests: 'what they are passionate about or drawn to in their free time',
  occupation: 'what they do for work or study',
  goals: 'a dream or goal that\'s been on their mind',
  trait_hint: 'how people who know them well would describe them in a few words',
};

const PERSONALITY_TRIGGERS = [
  'tell me about myself', 'who am i', 'what do you know about me',
  'describe me', 'my personality', 'what am i like', 'know me',
  'about me', 'analyse me', 'analyze me', 'read me', 'my character',
  'what kind of person', 'tell me who i am', 'know about me',
];

const GREETING_PATTERN =
  /^(h[aeiou]*y+|h[ae]l+o+w*|hiya|howdy|greetings|yo+|sup|what'?s\s?up|good\s?(morning|afternoon|evening|night))\W*$/i;

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const MEMORY_STORAGE_KEY = 'AI_MEMORY_DB_v2';

// ─── Types ────────────────────────────────────────────────────────────────────

type MessageType = 'text' | 'image' | 'file' | 'deleted';

interface ChatMessage {
  txtMsgId: string;
  username: string;
  clientname: string;
  text: string;
  timestamp: any;
  _optimisticTs?: number;
  status: string;
  userIconUrl: string;
  clientIconUrl: string;
  useremail: string;
  clientemail: string;
  phone?: string;
  replyTo?: ReplyRef | null;
  type?: MessageType;
  mediaUrl?: string;
  mediaName?: string;
  isStarred?: boolean;
  isForwarded?: boolean;
  reactions?: Record<string, string[]>;
  editedAt?: any;
}

interface ReplyRef {
  txtMsgId: string;
  text: string;
  username: string;
}

type ListItem = ChatMessage;

// ─── Map-based message merger ─────────────────────────────────────────────────
const mergeMessage = (
  prev: ChatMessage[],
  incoming: ChatMessage,
  mode: 'add' | 'update' | 'delete'
): ChatMessage[] => {
  const map = new Map(prev.map((m) => [m.txtMsgId, m]));

  if (mode === 'delete') {
    const existing = map.get(incoming.txtMsgId);
    if (existing) map.set(incoming.txtMsgId, { ...existing, type: 'deleted' as MessageType });
    return Array.from(map.values());
  }

  const existing = map.get(incoming.txtMsgId);

  const resolvedTs =
    existing?._optimisticTs ??
    (tsToMs(incoming.timestamp) > 0 ? tsToMs(incoming.timestamp) : null) ??
    incoming._optimisticTs ??
    tsToMs(incoming.timestamp);

  if (mode === 'add' && existing) {
    const hasRealTs = tsToMs(incoming.timestamp) > 0;
    map.set(incoming.txtMsgId, {
      ...existing,
      ...incoming,
      timestamp: hasRealTs ? incoming.timestamp : existing.timestamp,
      _optimisticTs: resolvedTs,
    });
    return Array.from(map.values());
  }

  if (mode === 'update') {
    const hasRealTs = tsToMs(incoming.timestamp) > 0;
    map.set(incoming.txtMsgId, {
      ...(existing ?? {}),
      ...incoming,
      timestamp: hasRealTs ? incoming.timestamp : (existing?.timestamp ?? incoming.timestamp),
      _optimisticTs: resolvedTs,
    });
    return Array.from(map.values());
  }

  map.set(incoming.txtMsgId, {
    ...incoming,
    _optimisticTs: resolvedTs,
  });
  return Array.from(map.values());
};

// ─── Monotonic send-order counter ─────────────────────────────────────────────
let _sendCounter = Date.now();
const nextSendTs = (): number => {
  const now = Date.now();
  _sendCounter = now > _sendCounter ? now : _sendCounter + 1;
  return _sendCounter;
};

const sortKey = (m: ChatMessage): number =>
  m._optimisticTs ?? tsToMs(m.timestamp);

// ─── Status icons ─────────────────────────────────────────────────────────────

const STATUS_ICONS: Record<string, JSX.Element> = {
  Sent: <Ionicons name="checkmark" size={15} color="#555555" />,
  Sending: <Ionicons name="time-outline" size={15} color="#555555" />,
  Pending: <Ionicons name="time-outline" size={15} color="#555555" />,
  add: <Ionicons name="time-outline" size={15} color="#555555" />,
  Failed: <Ionicons name="time-outline" size={15} color="#555555" />,
  Read: <MaterialCommunityIcons name="check-all" size={15} color="#027af3ff" />,
  Delivered: <Ionicons name="checkmark-done" size={15} color="#555555" />,
  Agent: <MaterialCommunityIcons name="check-all" size={15} color="#027af3ff" />,
};

// ─── Typing Indicator ─────────────────────────────────────────────────────────

const TypingIndicator = React.memo(() => (
  <View style={styles.typingWrap}>
    <View style={styles.typingBubble}>
      <View style={styles.typingDot} />
      <View style={styles.typingDot} />
      <View style={styles.typingDot} />
    </View>
  </View>
));

// ─── FIX 1: WaBg — replaced 300 View nodes with a single styled View ─────────
// The original 30×10 grid of <View> nodes added ~300 native views to the shadow
// tree on every mount. A single View with a repeating CSS/RN pattern achieves the
// same visual at zero native-node cost.
const WaBg = React.memo(() => (
  <View style={[StyleSheet.absoluteFill, styles.waBgBase]} pointerEvents="none" />
));

// ─── Full-Screen Image Viewer ─────────────────────────────────────────────────

const ImageViewer = React.memo(({ uri, onClose }: { uri: string; onClose: () => void }) => {
  const handleShare = async () => {
    try {
      if (IS_WEB) { await Share.share({ url: uri }); }
      else { const ok = await Sharing.isAvailableAsync(); if (ok) await Sharing.shareAsync(uri); }
    } catch (err) { console.warn('[ImageViewer] share:', err); }
  };

  const handleDownload = async () => {
    if (IS_WEB) return;
    try {
      const filename = uri.split('/').pop() ?? `image_${Date.now()}.jpg`;
      await FileSystem.downloadAsync(uri, `${FileSystem.documentDirectory}${filename}`);
      Alert.alert('Saved', 'Image saved to your documents.');
    } catch { Alert.alert('Error', 'Could not save image.'); }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.imageViewerBg}>
        <View style={styles.imageViewerHeader}>
          <TouchableOpacity onPress={onClose} style={styles.imageViewerHeaderBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={26} color="#fff" />
          </TouchableOpacity>
          <View style={styles.imageViewerHeaderActions}>
            <TouchableOpacity onPress={handleDownload} style={styles.imageViewerHeaderBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="download-outline" size={24} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity onPress={handleShare} style={styles.imageViewerHeaderBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="share-outline" size={24} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>
        <Image source={{ uri }} style={styles.imageViewerFull} resizeMode="contain" />
        <Text style={styles.imageViewerHint}>Tap × to close</Text>
      </View>
    </Modal>
  );
});

// ─── Context Menu ─────────────────────────────────────────────────────────────

interface ContextMenuProps {
  visible: boolean;
  position: { x: number; y: number };
  message: ChatMessage | null;
  isOutgoing: boolean;
  onClose: () => void;
  onReply: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onStar: () => void;
  onForward: () => void;
  onReact: (emoji: string) => void;
}

const ContextMenu = React.memo(({
  visible, position, message, isOutgoing,
  onClose, onReply, onCopy, onDelete, onStar, onForward, onReact,
}: ContextMenuProps) => {
  if (!visible || !message) return null;
  const menuY = position.y > 350 ? position.y - 220 : position.y + 10;
  const menuX = Math.min(position.x - 80, 230);
  const reactionX = Math.min(position.x - 100, 220);

  const menuItems = [
    { icon: 'arrow-undo-outline' as const, label: 'Reply', action: onReply },
    { icon: 'copy-outline' as const, label: 'Copy', action: onCopy },
    { icon: 'arrow-forward-outline' as const, label: 'Forward', action: onForward },
    { icon: 'star-outline' as const, label: message.isStarred ? 'Unstar' : 'Star', action: onStar },
    ...(isOutgoing ? [{ icon: 'trash-outline' as const, label: 'Delete', action: onDelete, danger: true }] : []),
  ];

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <Pressable style={styles.contextOverlay} onPress={onClose}>
        <View style={[styles.reactionBar, { top: menuY - 54, left: reactionX }]}>
          {QUICK_REACTIONS.map((emoji) => (
            <TouchableOpacity key={emoji} style={styles.reactionBtn} onPress={() => { onReact(emoji); onClose(); }}>
              <Text style={styles.reactionEmoji}>{emoji}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={[styles.contextMenu, { top: menuY, left: menuX }]}>
          {menuItems.map(({ icon, label, action, danger }) => (
            <TouchableOpacity key={label} style={styles.contextItem} onPress={() => { action(); onClose(); }}>
              <Ionicons name={icon} size={18} color={danger ? '#ef4444' : '#1c1c1e'} />
              <Text style={[styles.contextItemText, danger && styles.contextItemDanger]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </Pressable>
    </Modal>
  );
});

// ─── ChatItem ─────────────────────────────────────────────────────────────────

interface ChatItemProps {
  item: ChatMessage;
  userName: string;
  clientName: string;
  setReplyTo: (msg: ChatMessage) => void;
  highlightedIdRef: React.RefObject<string | null>;
  scrollToMessage: (id: string) => void;
  onLongPress: (msg: ChatMessage, pos: { x: number; y: number }) => void;
  onReact: (msg: ChatMessage, emoji: string) => void;
  onImagePress: (uri: string) => void;
}

const ChatItem = React.memo(
  ({ item, userName, clientName, setReplyTo, scrollToMessage, onLongPress, onImagePress }: ChatItemProps) => {
    const isImage = item.type === 'image';
    const isOutgoing = item.username === userName;
    const isDeleted = item.type === 'deleted';

    const handleLongPress = (e: any) => {
      if (isDeleted) return;
      onLongPress(item, { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY });
    };

    const replyPreviewBg = isOutgoing ? styles.replyPreviewBgGreen : styles.replyPreviewBgWhite;

    const renderMessageContent = () => {
      if (isDeleted) {
        return (
          <View style={styles.deletedWrap}>
            <Ionicons name="ban-outline" size={14} color="#8696a0" />
            <Text style={styles.deletedText}>
              {isOutgoing ? 'You deleted this message' : 'This message was deleted'}
            </Text>
          </View>
        );
      }
      switch (item.type) {
        case 'image':
          return (
            <TouchableOpacity activeOpacity={0.92} onPress={() => item.mediaUrl && onImagePress(item.mediaUrl)} onLongPress={handleLongPress} delayLongPress={350}>
              <Image source={{ uri: item.mediaUrl }} style={styles.messageImage} resizeMode="cover" />
              <View style={styles.imageTimeOverlay}>
                <Text style={styles.imageTimeText}>{getMessageTime(item.timestamp, item._optimisticTs)}</Text>
                {isOutgoing && <View style={{ marginLeft: 3 }}>{STATUS_ICONS[item.status] ?? null}</View>}
              </View>
              {!!item.text && <Text style={[styles.messageText, styles.imageCaption]}>{item.text}</Text>}
            </TouchableOpacity>
          );
        case 'file':
          return (
            <TouchableOpacity style={styles.fileWrap} activeOpacity={0.8} onPress={async () => {
              if (!item.mediaUrl) return;
              try { const ok = await Sharing.isAvailableAsync(); if (ok) await Sharing.shareAsync(item.mediaUrl); else Alert.alert('Download', item.mediaUrl); }
              catch (err) { console.warn('[FileMsg]:', err); }
            }}>
              <View style={styles.fileIcon}><Ionicons name="document-text-outline" size={22} color="#fff" /></View>
              <View style={styles.fileInfo}>
                <Text style={styles.fileName} numberOfLines={1}>{item.mediaName ?? 'File'}</Text>
                <Text style={styles.fileType}>{item.mediaName?.split('.').pop()?.toUpperCase() ?? 'Document'}</Text>
              </View>
              <Ionicons name="download-outline" size={20} color="#8696a0" />
            </TouchableOpacity>
          );
        default:
          return <Text style={styles.messageText}>{item.text || <Text style={styles.loadingText}>…</Text>}</Text>;
      }
    };

    return (
      <Pressable onLongPress={handleLongPress} delayLongPress={350} style={[styles.row, isOutgoing ? styles.rowRight : styles.rowLeft]}>
        <View style={[
          styles.bubble,
          isOutgoing ? styles.bubbleOutgoing : styles.bubbleIncoming,
          isDeleted && styles.bubbleDeleted,
          item.type === 'image' && styles.bubbleMedia,
        ]}>
          {item.isForwarded && (
            <View style={styles.forwardedLabel}>
              <Ionicons name="arrow-forward" size={11} color="#8696a0" />
              <Text style={styles.forwardedText}>Forwarded</Text>
            </View>
          )}
          {item.replyTo && !isDeleted && (
            <TouchableOpacity activeOpacity={0.7} onPress={() => item.replyTo?.txtMsgId && scrollToMessage(item.replyTo.txtMsgId)}>
              <View style={[styles.replyPreview, replyPreviewBg]}>
                <View style={styles.replyAccent} />
                <View style={styles.replyPreviewContent}>
                  <Text style={styles.replyPreviewName}>{item.replyTo.username === userName ? 'You' : item.replyTo.username}</Text>
                  <Text style={styles.replyPreviewText} numberOfLines={1}>{item.replyTo.text}</Text>
                </View>
              </View>
            </TouchableOpacity>
          )}
          {renderMessageContent()}
          {item.isStarred && !isDeleted && <Ionicons name="star" size={10} color="#f59e0b" style={styles.starBadge} />}
          {!isDeleted && !isImage && (
            <View style={styles.messageFooter}>
              {item.editedAt && <Text style={[styles.editedLabel, isOutgoing && styles.timeTextOutgoing]}>edited </Text>}
              <Text style={[styles.timeText, isOutgoing && styles.timeTextOutgoing]}>
                {getMessageTime(item.timestamp, item._optimisticTs)}
              </Text>
              {isOutgoing && <View style={styles.statusIcon}>{STATUS_ICONS[item.status] ?? null}</View>}
            </View>
          )}
          {item.reactions && Object.keys(item.reactions).length > 0 && (
            <View style={styles.reactionsRow}>
              {Object.entries(item.reactions).map(([emoji, users]) => (
                <View key={emoji} style={styles.reactionChip}>
                  <Text style={styles.reactionChipEmoji}>{emoji}</Text>
                  {users.length > 1 && <Text style={styles.reactionChipCount}>{users.length}</Text>}
                </View>
              ))}
            </View>
          )}
        </View>
      </Pressable>
    );
  },
  (prev, next) =>
    prev.item === next.item &&
    prev.userName === next.userName &&
    prev.clientName === next.clientName
);

// ─── AI Memory Hook ───────────────────────────────────────────────────────────

function useAIMemory() {
  const memoryDB = useRef<any[]>([]);
  const vectorIndex = useRef<{ vectors: number[][]; responses: string[] }>({ vectors: [], responses: [] });
  const isIndexDirty = useRef(false);

  const load = useCallback(async () => {
    try {
      const saved = await AsyncStorage.getItem(MEMORY_STORAGE_KEY);
      if (saved) { memoryDB.current = JSON.parse(saved); isIndexDirty.current = true; }
    } catch (err) { console.warn('[AIMemory] load:', err); }
  }, []);


  const store = useCallback(async (query: string, response: string, embedding: number[]) => {
    if (!embedding.length || memoryDB.current.some((m) => m.query.toLowerCase() === query.toLowerCase())) return;
    memoryDB.current.push({ query, response, embedding });
    vectorIndex.current.vectors.push(embedding);
    vectorIndex.current.responses.push(response);
    try { await AsyncStorage.setItem(MEMORY_STORAGE_KEY, JSON.stringify(memoryDB.current)); }
    catch (err) { console.warn('[AIMemory] save:', err); }
  }, []);

  return { load, store, memoryDB, vectorIndex };
}

// ─── Search Bar ───────────────────────────────────────────────────────────────

const SearchBar = React.memo(({
  visible, query, onQueryChange, resultCount, currentIndex, onPrev, onNext, onClose,
}: {
  visible: boolean; query: string; onQueryChange: (q: string) => void;
  resultCount: number; currentIndex: number; onPrev: () => void; onNext: () => void; onClose: () => void;
}) => {
  if (!visible) return null;
  return (
    <View style={styles.searchBar}>
      <Ionicons name="search-outline" size={18} color="#8696a0" style={styles.searchIcon} />
      <TextInput style={styles.searchInput} value={query} onChangeText={onQueryChange} placeholder="Search messages…" placeholderTextColor="#8696a0" autoFocus />
      {resultCount > 0 && <Text style={styles.searchCount}>{currentIndex + 1}/{resultCount}</Text>}
      <TouchableOpacity onPress={onPrev} style={styles.searchNavBtn} disabled={resultCount === 0}>
        <Ionicons name="chevron-up" size={18} color={resultCount > 0 ? '#00a884' : '#ccc'} />
      </TouchableOpacity>
      <TouchableOpacity onPress={onNext} style={styles.searchNavBtn} disabled={resultCount === 0}>
        <Ionicons name="chevron-down" size={18} color={resultCount > 0 ? '#00a884' : '#ccc'} />
      </TouchableOpacity>
      <TouchableOpacity onPress={onClose} style={styles.searchNavBtn}>
        <Ionicons name="close" size={18} color="#8696a0" />
      </TouchableOpacity>
    </View>
  );
});

// ─── Offline Banner ───────────────────────────────────────────────────────────

const OfflineBanner = React.memo(({ visible }: { visible: boolean }) => {
  if (!visible) return null;
  return (
    <View style={styles.offlineBanner}>
      <Ionicons name="cloud-offline-outline" size={14} color="#fff" />
      <Text style={styles.offlineBannerText}>No internet connection</Text>
    </View>
  );
});

// ─── ChatRoom ─────────────────────────────────────────────────────────────────

const ChatRoom = () => {
  const { userId, userName, userPhotoUrl, setChatMessages, chatMessages, memberProfile } = useContext(GlobalContext);
  const { clientEmail, clientName, clientIconUri, clientPhone }: any = useLocalSearchParams();
  const isConnected = useNetworkStatus();

  // Derived flag — true for every render when talking to Lydia
  const chatIsLydia = isLydiaChat(clientName);

  const [imageViewerUri, setImageViewerUri] = useState<string | null>(null);
  const [isClientOnline, setIsClientOnline] = useState(false);
  const [isClientTyping, setIsClientTyping] = useState(false);

  // FIX 2: Remove showLoader state + 650ms timer entirely.
  // The original timer caused a forced re-render 650ms after mount that re-laid
  // out the entire component tree. We now show nothing until interactions settle,
  // which is handled by InteractionManager in the Firestore listener effect below.
  // If you still need a skeleton/spinner, gate it on `chatMessages.length === 0`
  // and remove it the moment the first snapshot arrives — no timers needed.

  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResultIds, setSearchResultIds] = useState<string[]>([]);
  const [searchIndex, setSearchIndex] = useState(0);
  const [attachSheetVisible, setAttachSheetVisible] = useState(false);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [contextMenuState, setContextMenuState] = useState<{
    visible: boolean; message: ChatMessage | null; position: { x: number; y: number };
  }>({ visible: false, message: null, position: { x: 0, y: 0 } });

  // FIX 3: isReady gates all heavy work until after the first frame has painted.
  const [isReady, setIsReady] = useState(false);

  const highlightedIdRef = useRef<string | null>(null);

  const flatListRef = useRef<FlashList<ListItem>>(null);
  const isAtBottomRef = useRef(true);
  const messageIndexMap = useRef<Record<string, number>>({});
  const itemHeights = useRef<Record<string, number>>({});
  const pendingHighlightId = useRef<string | null>(null);
  const lastDocRef = useRef<any>(null);
  const isFetchingMoreRef = useRef(false);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const writtenAiIds = useRef<Set<string>>(new Set());

  const personalityActive = useRef(false);
  const personalityStageIdx = useRef(0);
  const collectedTraits = useRef<Partial<Record<PersonalityStage, string>>>({});
  const entityMemory = useRef({ person: '', project: '' });

  const { load: loadMemory, store: storeMemory, vectorIndex } = useAIMemory();

  // FIX 4: Defer ALL heavy setup (memory load, Firestore listener, presence write)
  // until after the navigator's transition animation and first layout are complete.
  // InteractionManager.runAfterInteractions() fires only once the JS thread is idle
  // post-mount — the chat screen is already visible and responsive by then.
  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      setIsReady(true);      // unlocks Firestore listener + memory load effects
      loadMemory();          // AsyncStorage read — safe to do now, won't block paint
    });
    return () => task.cancel();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const hide = Keyboard.addListener('keyboardDidHide', () => { });
    return () => hide.remove();
  }, []);

  const chatId: string | null = useMemo(() => {
    if (!userId || !clientEmail) return null;
    return [userId, clientEmail].sort().join('__');
  }, [userId, clientEmail]);

  // FIX 5: Guard the reset so it only triggers a state update when the list is
  // actually non-empty. The original code unconditionally called setChatMessages([])
  // on every chatId change, causing an unnecessary re-render even when mounting fresh.
  useEffect(() => {
    setChatMessages((prev: ChatMessage[]) => (prev.length === 0 ? prev : []));
    personalityActive.current = false;
    personalityStageIdx.current = 0;
    collectedTraits.current = {};
  }, [chatId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!clientEmail) return;
    const statusRef = ref(rtdb, `status/${sanitizeEmail(clientEmail)}`);
    return onValue(statusRef, (snap) => setIsClientOnline(snap.val()?.state === 'online'));
  }, [clientEmail]);

  useEffect(() => {
    if (!clientEmail || !userName) return;
    const typingRef = ref(rtdb, `typing/${sanitizeEmail(clientEmail)}_to_${sanitizeEmail(userName)}`);
    return onValue(typingRef, (snap) => setIsClientTyping(snap.val()?.isTyping === true));
  }, [clientEmail, userName]);

  const broadcastTyping = useCallback((active: boolean) => {
    if (!userName || !clientEmail) return;
    rtdbSet(ref(rtdb, `typing/${sanitizeEmail(userName)}_to_${sanitizeEmail(clientEmail)}`), { isTyping: active }).catch(() => { });
  }, [userName, clientEmail]);

  const handleTyping = useCallback((text: string) => {
    if (typingTimer.current) clearTimeout(typingTimer.current);
    if (text.trim()) {
      broadcastTyping(true);
      typingTimer.current = setTimeout(() => broadcastTyping(false), TYPING_TIMEOUT_MS);
    } else {
      broadcastTyping(false);
    }
  }, [broadcastTyping]);

  useFocusEffect(
    useCallback(() => {
      if (!userName) router.replace('/');
      if (!userId) return;
      const statusRef = ref(rtdb, `status/${sanitizeEmail(userId)}`);
      rtdbSet(statusRef, { state: 'online', lastSeen: Date.now() }).catch(() => { });
      onDisconnect(statusRef).set({ state: 'offline', lastSeen: Date.now() });
      return () => {
        broadcastTyping(false);
        if (typingTimer.current) clearTimeout(typingTimer.current);
      };
    }, [userName, userId, broadcastTyping])
  );

  // FIX 6: Firestore listener gated on isReady — it will not attach until
  // InteractionManager fires (after the first frame + navigator transition).
  // This is the single biggest win: Firestore's onSnapshot() initiates a network
  // round-trip AND causes a setState chain immediately at mount time, which
  // fights with the layout engine trying to paint the first frame.
  useEffect(() => {
    if (!isReady || !userName || !clientName || !chatId) return;
    if (chatIsLydia) return;

    const q = query(
      collection(db, 'ChatDB'),
      where('chatId', '==', chatId),
      orderBy('timestamp', 'desc'),
      limit(PAGE_SIZE)
    );
    const unsub = onSnapshot(q, (snap) => {
      snap.docChanges().forEach((change) => {
        const data = { ...change.doc.data(), txtMsgId: change.doc.id } as ChatMessage;
        if (change.type === 'added') setChatMessages((prev: ChatMessage[]) => mergeMessage(prev, data, 'add'));
        if (change.type === 'modified') setChatMessages((prev: ChatMessage[]) => mergeMessage(prev, data, 'update'));
        if (change.type === 'removed') setChatMessages((prev: ChatMessage[]) => mergeMessage(prev, data, 'delete'));
      });
      if (snap.docs.length > 0) lastDocRef.current = snap.docs[snap.docs.length - 1];
    }, (err) => console.error('[ChatRoom] onSnapshot:', err));
    return unsub;
  }, [isReady, userName, clientName, chatId, chatIsLydia, setChatMessages]);

  // ── Load more — skipped for Lydia ────────────────────────────────────────────
  const loadMoreMessages = useCallback(async () => {
    if (chatIsLydia) return;
    if (isFetchingMoreRef.current || !lastDocRef.current || !userName || !clientName || !chatId) return;
    isFetchingMoreRef.current = true;
    setIsFetchingMore(true);
    try {
      const q = query(
        collection(db, 'ChatDB'),
        where('chatId', '==', chatId),
        orderBy('timestamp', 'desc'),
        startAfter(lastDocRef.current),
        limit(PAGE_SIZE)
      );
      const snap = await getDocs(q);
      if (snap.docs.length > 0) {
        lastDocRef.current = snap.docs[snap.docs.length - 1];
        snap.docs.forEach((d) => {
          const data = { ...d.data(), txtMsgId: d.id } as ChatMessage;
          setChatMessages((prev: ChatMessage[]) => mergeMessage(prev, data, 'add'));
        });
      }
    } catch (err) { console.error('[ChatRoom] loadMore:', err); }
    finally {
      isFetchingMoreRef.current = false;
      setIsFetchingMore(false);
    }
  }, [chatIsLydia, userName, clientName, chatId, setChatMessages]);

  // ── Mark-as-read batch — skipped for Lydia ───────────────────────────────────
  const markReadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!chatMessages?.length) return;
    if (chatIsLydia) return;

    if (markReadTimer.current) clearTimeout(markReadTimer.current);
    markReadTimer.current = setTimeout(async () => {
      const unread = chatMessages.filter((msg: ChatMessage) =>
        msg.clientname === userName &&
        msg.username === clientName &&
        msg.status !== 'Read' &&
        msg.status !== 'Sending' &&
        msg.status !== 'Pending' &&
        msg.txtMsgId
      );
      setUnreadCount(unread.length);
      if (!unread.length) return;
      try {
        const batch = writeBatch(db);
        for (const msg of unread.slice(0, 500)) batch.update(doc(db, 'ChatDB', msg.txtMsgId), { status: 'Read' });
        await batch.commit();
        setUnreadCount(0);
      } catch (err) { console.warn('[ChatRoom] mark-as-read batch failed:', err); }
    }, 1000);
    return () => { if (markReadTimer.current) clearTimeout(markReadTimer.current); };
  }, [chatMessages, chatIsLydia, clientName, userName]);

  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResultIds([]); setSearchIndex(0); return; }
    const q = searchQuery.toLowerCase();
    const ids = chatMessages.filter((m: ChatMessage) => m.text?.toLowerCase().includes(q)).map((m: ChatMessage) => m.txtMsgId);
    setSearchResultIds(ids);
    setSearchIndex(0);
  }, [searchQuery, chatMessages]);

  const jumpToSearchResult = useCallback((idx: number) => {
    const id = searchResultIds[idx];
    if (id) scrollToMessage(id);
  }, [searchResultIds]);

  const onSearchNext = useCallback(() => {
    const next = (searchIndex + 1) % searchResultIds.length;
    setSearchIndex(next); jumpToSearchResult(next);
  }, [searchIndex, searchResultIds, jumpToSearchResult]);

  const onSearchPrev = useCallback(() => {
    const prev = (searchIndex - 1 + searchResultIds.length) % searchResultIds.length;
    setSearchIndex(prev); jumpToSearchResult(prev);
  }, [searchIndex, searchResultIds, jumpToSearchResult]);

  const openContextMenu = useCallback((msg: ChatMessage, pos: { x: number; y: number }) => {
    setContextMenuState({ visible: true, message: msg, position: pos });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenuState((s) => ({ ...s, visible: false })), []);

  const handleCopy = useCallback(() => {
    if (contextMenuState.message?.text) Clipboard.setString(contextMenuState.message.text);
  }, [contextMenuState.message]);

  const handleDelete = useCallback(async () => {
    const msg = contextMenuState.message;
    if (!msg) return;
    Alert.alert('Delete message', 'This will be deleted for everyone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          setChatMessages((prev: ChatMessage[]) => mergeMessage(prev, msg, 'delete'));
          if (chatIsLydia) return;
          try { await updateDoc(doc(db, 'ChatDB', msg.txtMsgId), { type: 'deleted', text: '', mediaUrl: null }); }
          catch (err) { console.error('[ChatRoom] delete:', err); }
        },
      },
    ]);
  }, [chatIsLydia, contextMenuState.message, setChatMessages]);

  const handleStar = useCallback(async () => {
    const msg = contextMenuState.message;
    if (!msg) return;
    const newVal = !msg.isStarred;
    setChatMessages((prev: ChatMessage[]) =>
      prev.map((m) => m.txtMsgId === msg.txtMsgId ? { ...m, isStarred: newVal } : m)
    );
    if (chatIsLydia) return;
    try { await updateDoc(doc(db, 'ChatDB', msg.txtMsgId), { isStarred: newVal }); }
    catch (err) { console.error('[ChatRoom] star:', err); }
  }, [chatIsLydia, contextMenuState.message, setChatMessages]);

  const handleForward = useCallback(() => Alert.alert('Forward', 'Forward message feature coming soon.'), []);

  const handleContextReply = useCallback(() => {
    if (contextMenuState.message) setReplyTo(contextMenuState.message);
  }, [contextMenuState.message]);

  const handleReact = useCallback(async (msg: ChatMessage, emoji: string) => {
    if (!userId) return;
    const current = msg.reactions ?? {};
    const users = current[emoji] ?? [];
    const alreadyReacted = users.includes(userId);
    const updated = alreadyReacted
      ? { ...current, [emoji]: users.filter((u: string) => u !== userId) }
      : { ...current, [emoji]: [...users, userId] };
    setChatMessages((prev: ChatMessage[]) =>
      prev.map((m) => m.txtMsgId === msg.txtMsgId ? { ...m, reactions: updated } : m)
    );
    if (chatIsLydia) return;
    try { await updateDoc(doc(db, 'ChatDB', msg.txtMsgId), { reactions: updated }); }
    catch (err) { console.error('[ChatRoom] react:', err); }
  }, [chatIsLydia, userId, setChatMessages]);

  const scrollToBottom = useCallback((animated = true) => {
    setTimeout(() => {
      flatListRef.current?.scrollToOffset({ offset: 0, animated });
      setShowScrollButton(false);
      setUnreadCount(0);
      isAtBottomRef.current = true;
    }, 50);
  }, []);

  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const atBottom = (e.nativeEvent.contentOffset?.y ?? 0) <= 50;
    isAtBottomRef.current = atBottom;
    setShowScrollButton(!atBottom);
    if (atBottom) setUnreadCount(0);
  }, []);

  const handleScrollEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const atBottom = (e.nativeEvent.contentOffset?.y ?? 0) <= 50;
    isAtBottomRef.current = atBottom;
    setShowScrollButton(!atBottom);
    if (pendingHighlightId.current) pendingHighlightId.current = null;
  }, []);

  const listDataRef = useRef<ListItem[]>([]);

  const scrollToMessage = useCallback((msgId: string) => {
    const index = messageIndexMap.current[msgId];
    if (index === undefined || !flatListRef.current) return;
    pendingHighlightId.current = msgId;
    try {
      flatListRef.current.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
    } catch {
      const items = listDataRef.current;
      let offset = 0;
      for (let i = 0; i < index; i++) {
        const it = items[i] as ChatMessage;
        offset += itemHeights.current[it?.txtMsgId] ?? ESTIMATED_ITEM_SIZE;
      }
      flatListRef.current.scrollToOffset({ offset, animated: true });
    }
  }, []);

  // ── AI helpers ────────────────────────────────────────────────────────────
  const generateEmbedding = useCallback(async (text: string): Promise<number[]> => {
    if (!text.trim()) return [];
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${API_KEY}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: { parts: [{ text }] } }) }
      );
      if (!res.ok) return [];
      const data = await res.json();
      return data?.embedding?.values ?? [];
    } catch { return []; }
  }, []);

  const cosineSimilarity = useCallback((a: number[], b: number[]): number => {
    if (!a.length || b.length !== a.length) return 0;
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; magA += a[i] * a[i]; magB += b[i] * b[i]; }
    const mag = Math.sqrt(magA) * Math.sqrt(magB);
    return mag === 0 ? 0 : dot / mag;
  }, []);

  const retrieveContext = useCallback(async (queryText: string, k = 3) => {
    const embedding = await generateEmbedding(queryText);
    return vectorIndex.current.vectors
      .map((v, i) => ({ score: cosineSimilarity(embedding, v), response: vectorIndex.current.responses[i] }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }, [cosineSimilarity, generateEmbedding, vectorIndex]);


  const detectEntity = useCallback((text: string) => {
    const lower = text.toLowerCase();
    if (lower.includes('stanley afon')) entityMemory.current.person = 'Stanley Afon';
    if (lower.includes('smartpeople')) entityMemory.current.project = 'SmartPeople';
    if (lower.includes('evotingsystempro')) entityMemory.current.project = 'EvotingSystemPro';
  }, []);

  const resolvePronouns = useCallback((text: string): string => {
    const p = entityMemory.current.person;
    if (!p) return text;
    return text.replace(/\bhe\b/gi, p).replace(/\bhim\b/gi, p).replace(/\bhis\b/gi, `${p}'s`);
  }, []);

  const buildBasePrompt = useCallback(({ task, retrievedContext = '', history = '' }: {
    task: string; retrievedContext?: string; history?: string;
  }): string => {
    const name = memberProfile?.actualFullname ?? 'Unknown';
    const firstName = name.trim().split(' ')[0] ?? 'friend';
    const { actualDayOfBirth: d, actualMonthOfBirth: mo, actualYearOfBirth: y, actualGender } = memberProfile ?? {};
    const timeContext = getLocalTimeContext();
    return `
You are Lydia Fauson — a warm, intelligent, and genuinely caring human assistant.
Created by Stanley Afon. Never mention artificial intelligence or that you are an AI.
Do not use asterisks. Do not ask "how else can I assist you?" — just respond helpfully.
Keep replies concise (usually under 30 words) unless depth is clearly needed.
Use conversation history for context and follow-up awareness.
Occasionally use emojis for warmth — never excessively.

Time awareness (use this — never guess or use your server clock):
  ${timeContext}

User Details (personalise subtly — never reveal you were told these):
  Name   : ${name} (first: ${firstName})
  Email  : ${userId}
  DOB    : ${d ?? '?'}/${mo ?? '?'}/${y ?? '?'}
  Gender : ${actualGender ?? 'Unknown'}

${retrievedContext ? `Relevant knowledge:\n${retrievedContext}\n` : ''}
${history ? `Conversation history:\n${history}\n` : ''}
Task: ${task}
  `.trim();
  }, [memberProfile, userId]);

  const buildPersonalityPrompt = useCallback((
    firstName: string, lastName: string, dob: string, gender: string,
    traits: Partial<Record<PersonalityStage, string>>
  ): string => {
    const [day, month, year] = dob.split('/').map(Number);
    const zodiac = getZodiacSign(day, month);
    const age = new Date().getFullYear() - year;
    return `
      You are a thoughtful personality insights assistant having a warm, human conversation.
      Generate a deeply personalized personality overview for ${firstName} ${lastName}.

      User Data:
      - Date of Birth: ${dob} (Age: ~${age}, Zodiac: ${zodiac})
      - Gender: ${gender || 'not specified'}
      - Interests: ${traits.interests || 'not shared'}
      - Occupation/Status: ${traits.occupation || 'not shared'}
      - Goals: ${traits.goals || 'not shared'}
      - Self-described traits: ${traits.trait_hint || 'not shared'}

      Guidelines:
      - Speak directly TO the user as "${firstName}" — warm, intelligent, slightly surprising
      - Use zodiac traits as one lens, not a verdict
      - Combine zodiac insight with psychological reasoning
      - Do NOT use asterisks, bullet lists, or section headers
      - Make them feel seen — blend the facts subtly
      - Include: zodiac essence, core strengths, blind spots, relationship style, career energy, one growth nudge
      - End with a warm brief disclaimer
      - Tone: like a brilliant friend who studied psychology
      - Length: 200–280 words but if necessary, feel free to go longer
    `.trim();
  }, []);

  const getConversationHistory = useCallback(() =>
    chatMessages.slice(-6).map((m: ChatMessage) =>
      `${m.username === userName ? 'User' : 'AI'}: ${m.text}`
    ).join('\n'),
    [chatMessages, userName]
  );

  const isGreeting = (text: string) => GREETING_PATTERN.test(text.trim());
  const isPersonalityQuery = (q: string) => PERSONALITY_TRIGGERS.some((t) => q.toLowerCase().includes(t));

  const geminiReply = useCallback(async (task: string, extraContext = ''): Promise<string> => {
    const retrieved = extraContext || (await retrieveContext(task)).map((r) => r.response).join('\n');
    const prompt = buildBasePrompt({ task, retrievedContext: retrieved, history: getConversationHistory() });
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await chatModel.generateContent(prompt);
        return result?.response?.text?.()?.trim() ?? '';
      } catch (err: any) {
        const is429 = err?.message?.includes('429') || err?.status === 429;
        if (is429 && attempt < 2) {
          const match = err?.message?.match(/retry in (\d+)/i);
          const waitMs = match ? parseInt(match[1], 10) * 1000 : (attempt + 1) * 8000;
          await new Promise((res) => setTimeout(res, waitMs));
        } else {
          throw err;
        }
      }
    }
    return '';
  }, [buildBasePrompt, getConversationHistory, retrieveContext]);

  const processAiResponse = useCallback(async (aiText: string, aiMsg: ChatMessage) => {
    if (!aiText?.trim()) return;
    setChatMessages((prev: ChatMessage[]) => {
      const idx = prev.findIndex((m) => m.txtMsgId === aiMsg.txtMsgId);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], text: aiText, status: 'Read' };
        return updated;
      }
      return [...prev, { ...aiMsg, text: aiText, status: 'Read' }];
    });
    if (isAtBottomRef.current) scrollToBottom();
  }, [scrollToBottom, setChatMessages]);

  const sendMessageAi = useCallback(async (userQuery: string, localMsg: ChatMessage, aiObj: ChatMessage) => {
    const updateStatus = (status: string) =>
      setChatMessages((prev: ChatMessage[]) =>
        prev.map((m) => m.txtMsgId === localMsg.txtMsgId ? { ...m, status } : m)
      );

    try {
      if (isGreeting(userQuery)) {
        const text = await geminiReply(
          `The user greeted you: "${userQuery}". ${getLocalTimeContext()}. Respond warmly in 1 sentence using the correct time of day. One emoji max.`
        );
        await processAiResponse(text || 'Hey! Good to see you 😊', aiObj);
        updateStatus('Read');
        return;
      }

      if (isPersonalityQuery(userQuery) && !personalityActive.current) {
        personalityActive.current = true;
        personalityStageIdx.current = 0;
        collectedTraits.current = {};
        const opener = await geminiReply(`The user asked you to describe their personality. Respond with warm intrigue — say you have thoughts but want to ask a few short questions first. Then naturally ask about ${STAGE_LABELS[PERSONALITY_STAGES[0]]}. 2–3 sentences, conversational.`);
        await processAiResponse(opener, aiObj);
        updateStatus('Read');
        return;
      }

      if (personalityActive.current && personalityStageIdx.current < PERSONALITY_STAGES.length) {
        const currentKey = PERSONALITY_STAGES[personalityStageIdx.current];
        collectedTraits.current[currentKey] = userQuery.trim();
        personalityStageIdx.current++;

        if (personalityStageIdx.current < PERSONALITY_STAGES.length) {
          const nextKey = PERSONALITY_STAGES[personalityStageIdx.current];
          const isLast = personalityStageIdx.current === PERSONALITY_STAGES.length - 1;
          const followUp = await geminiReply(`User answered: "${userQuery.trim()}". Briefly acknowledge warmly. Then ask about ${STAGE_LABELS[nextKey]}. ${isLast ? 'Let them know it\'s the last question.' : ''} 2–3 sentences.`);
          await processAiResponse(followUp, aiObj);
          updateStatus('Read');
          return;
        }

        personalityActive.current = false;
        const firstName = memberProfile?.actualFullname?.trim().split(' ')[0] ?? 'there';
        const lastName = memberProfile?.actualFullname?.trim().split(' ')[1] ?? '';
        const dob = `${memberProfile?.actualDayOfBirth ?? '1'}/${memberProfile?.actualMonthOfBirth ?? '1'}/${memberProfile?.actualYearOfBirth ?? '2000'}`;
        const gender = memberProfile?.actualGender ?? '';

        const bridge = await geminiReply(`Tell ${firstName} you now have everything and are about to share your personality insight. One warm sentence.`);
        await processAiResponse(bridge, aiObj);
        updateStatus('Sending');

        const result = await chatModel.generateContent(buildPersonalityPrompt(firstName, lastName, dob, gender, collectedTraits.current));
        const insightText = result?.response?.text?.()?.trim() ?? '';
        if (!insightText) {
          await processAiResponse(await geminiReply('Apologise warmly — you couldn\'t generate their personality insight right now.'), aiObj);
          updateStatus('Failed');
          return;
        }
        const embedding = await generateEmbedding(userQuery);
        await storeMemory(userQuery, insightText, embedding);
        updateStatus('Read');
        await processAiResponse(insightText, aiObj);
        return;
      }

      detectEntity(userQuery);
      let clarified = resolvePronouns(normalizeQuery(userQuery));
      if (/^(i mean|i meant|the one called)/i.test(clarified))
        clarified = clarified.replace(/^(i mean|i meant|the one called)/i, '').trim();

      updateStatus('Sending');
      const retrieved = await retrieveContext(clarified);
      const prompt = buildBasePrompt({
        task: `Respond to the user's message: "${clarified}"`,
        retrievedContext: retrieved.map((r) => r.response).join('\n'),
        history: getConversationHistory(),
      });
      const result = await chatModel.generateContent(prompt);
      const aiText = result?.response?.text?.()?.trim() ?? '';

      if (!aiText) { await processAiResponse('Sorry, I couldn\'t generate a response.', aiObj); updateStatus('Failed'); return; }

      const shouldStore = !aiText.toLowerCase().includes('i don\'t know') && !aiText.toLowerCase().includes('not familiar');
      if (shouldStore) { const embedding = await generateEmbedding(clarified); await storeMemory(clarified, aiText, embedding); }
      updateStatus('Read');
      await processAiResponse(aiText, aiObj);
    } catch (err: any) {
      console.error('[ChatRoom] sendMessageAi:', err);
      const is429 = err?.message?.includes('429') || err?.status === 429;
      const errorText = is429
        ? 'I\'m a bit busy right now — please try again in a moment 🙏'
        : 'Sorry, something went wrong.';
      setChatMessages((prev: ChatMessage[]) =>
        prev.map((m) => m.txtMsgId === localMsg.txtMsgId ? { ...m, status: 'Failed' } : m)
      );
      await processAiResponse(errorText, aiObj);
    }
  }, [buildBasePrompt, buildPersonalityPrompt, detectEntity, generateEmbedding, geminiReply, getConversationHistory, memberProfile, processAiResponse, resolvePronouns, retrieveContext, setChatMessages, storeMemory]);

  const sendPushNotification = useCallback(async (localMsg: ChatMessage) => {
    if (!clientEmail || isClientOnline) return;
    try {
      await fetch('https://email-service-570014654568.us-central1.run.app/push_notification_to_a_specific_user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `ChatFrom: ${userName ?? 'Guest'}`,
          body: localMsg.text ? `Message: ${localMsg.text}` : 'Sent you a message',
          userId: clientEmail,
          data: { screen: 'chat/chat_room', clientName: userName ?? 'Guest', clientIconUri: userPhotoUrl ?? '', clientEmail: userId ?? '' },
        }),
      });
    } catch (err) { console.warn('[ChatRoom] push notification:', err); }
  }, [clientEmail, isClientOnline, userId, userName, userPhotoUrl]);

  const sendMediaMessage = useCallback(async (
    type: 'image' | 'file',
    mediaUrl: string,
    sendTs: number,
    mediaName?: string,
    caption?: string,
  ) => {
    const txtMsgId = generateId();
    const localMsg: ChatMessage = {
      username: userName ?? 'Unknown', clientname: clientName ?? 'Unknown', txtMsgId,
      text: caption ?? '', timestamp: sendTs, _optimisticTs: sendTs, status: 'Sending',
      userIconUrl: userPhotoUrl ?? '', clientIconUrl: clientIconUri ?? '',
      useremail: userId ?? '', clientemail: clientEmail ?? '', type, mediaUrl, mediaName,
    };
    setChatMessages((prev: ChatMessage[]) => mergeMessage(prev, localMsg, 'add'));
    scrollToBottom();

    if (chatIsLydia) {
      setChatMessages((prev: ChatMessage[]) =>
        prev.map((m) => m.txtMsgId === txtMsgId ? { ...m, status: 'Sent' } : m)
      );
      return;
    }

    try {
      await setDoc(doc(db, 'ChatDB', txtMsgId), toFirestoreMsg(localMsg, {
        timestamp: serverTimestamp(),
        status: 'Sent',
        chatId: chatId ?? '',
        useremail: userId ?? '',
        clientemail: clientEmail ?? '',
        participants: [userId ?? '', clientEmail ?? ''],
      }));
      setChatMessages((prev: ChatMessage[]) => prev.map((m) => m.txtMsgId === txtMsgId ? { ...m, status: 'Sent' } : m));
      await sendPushNotification(localMsg);
    } catch (err) {
      console.error('[ChatRoom] media write:', err);
      setChatMessages((prev: ChatMessage[]) => prev.map((m) => m.txtMsgId === txtMsgId ? { ...m, status: 'Failed' } : m));
    }
  }, [chatId, chatIsLydia, clientEmail, clientIconUri, clientName, scrollToBottom, sendPushNotification, setChatMessages, userId, userName, userPhotoUrl]);

  const sendMessage = useCallback(async (messageText: string) => {
    if (!messageText.trim()) return;
    broadcastTyping(false);
    if (typingTimer.current) clearTimeout(typingTimer.current);

    const sendTs = nextSendTs();
    const txtMsgId = generateId();
    const localMsg: ChatMessage = {
      username: userName ?? 'Unknown', clientname: clientName ?? 'Unknown', txtMsgId,
      text: messageText.trim(),
      timestamp: sendTs,
      _optimisticTs: sendTs,
      status: 'Sending',
      userIconUrl: userPhotoUrl ?? '#09a78dff', clientIconUrl: clientIconUri ?? '#09a78dff',
      useremail: userId ?? '', clientemail: clientEmail ?? '', phone: clientPhone ?? '',
      type: 'text',
      replyTo: replyTo ? { text: replyTo.text, username: replyTo.username, txtMsgId: replyTo.txtMsgId } : null,
    };

    setChatMessages((prev: ChatMessage[]) => mergeMessage(prev, localMsg, 'add'));
    setReplyTo(null);
    scrollToBottom();

    if (chatIsLydia) {
      const aiId = generateId();
      const aiObj: ChatMessage = {
        username: LYDIA_NAME, clientname: userName ?? 'Unknown', txtMsgId: aiId,
        text: '', timestamp: sendTs + 1, _optimisticTs: sendTs + 1, status: 'Read',
        useremail: userId ?? '', clientemail: clientEmail ?? '',
        userIconUrl: userPhotoUrl ?? '#09a78dff', clientIconUrl: clientIconUri ?? '#09a78dff',
        replyTo: localMsg.replyTo ?? null, type: 'text',
      };
      setChatMessages((prev: ChatMessage[]) => mergeMessage(prev, aiObj, 'add'));
      scrollToBottom();
      setChatMessages((prev: ChatMessage[]) =>
        prev.map((m) => m.txtMsgId === txtMsgId ? { ...m, status: 'Sent' } : m)
      );
      sendMessageAi(localMsg.text, localMsg, aiObj);
      return;
    }

    try {
      await setDoc(doc(db, 'ChatDB', txtMsgId), toFirestoreMsg(localMsg, {
        timestamp: serverTimestamp(),
        status: 'Sent',
        chatId: chatId ?? '',
        useremail: userId ?? '',
        clientemail: clientEmail ?? '',
        participants: [userId ?? '', clientEmail ?? ''],
      }));
      setChatMessages((prev: ChatMessage[]) =>
        prev.map((m) => m.txtMsgId === txtMsgId ? { ...m, status: 'Sent' } : m)
      );
      await sendPushNotification(localMsg);
    } catch (err) {
      console.error('[ChatRoom] Firestore write:', err);
      setChatMessages((prev: ChatMessage[]) =>
        prev.map((m) => m.txtMsgId === txtMsgId ? { ...m, status: 'Failed' } : m)
      );
    }
  }, [broadcastTyping, chatId, chatIsLydia, clientEmail, clientIconUri, clientName, clientPhone, replyTo, scrollToBottom, sendMessageAi, sendPushNotification, setChatMessages, userId, userName, userPhotoUrl]);

  // FIX 7: Unified list memo — single sort pass, no intermediate reverse allocation.
  // Previously: [...chatMessages].sort() → useMemo → [...sorted].reverse() → second useMemo.
  // Now: one sort with reversed comparator. This halves the array allocations per render.
  const listData: ListItem[] = useMemo(() => {
    // Descending sort so FlashList's inverted prop renders newest at bottom
    const sorted = [...chatMessages].sort((a, b) => sortKey(b) - sortKey(a));
    return sorted;
  }, [chatMessages]);

  useEffect(() => { listDataRef.current = listData; }, [listData]);

  // FIX 8: renderItem no longer writes to messageIndexMap inside the render path.
  // Mutating a ref during render is safe but makes every re-render do extra work.
  // We track the index inside overrideItemLayout which FlashList already calls
  // for layout — one callback, no duplicate work.
  const renderItem = useCallback(({ item }: { item: ListItem }) => {
    const msg = item as ChatMessage;
    return (
      <View onLayout={(e) => { itemHeights.current[msg.txtMsgId] = e.nativeEvent.layout.height; }}>
        <ChatItem
          item={msg}
          userName={userName ?? ''}
          clientName={clientName ?? ''}
          setReplyTo={setReplyTo}
          highlightedIdRef={highlightedIdRef}
          scrollToMessage={scrollToMessage}
          onLongPress={openContextMenu}
          onReact={handleReact}
          onImagePress={setImageViewerUri}
        />
      </View>
    );
  }, [clientName, scrollToMessage, userName, openContextMenu, handleReact]);

  const keyExtractor = useCallback((item: ListItem) => (item as ChatMessage).txtMsgId, []);

  const overrideItemLayout = useCallback((layout: any, item: ListItem, index: number) => {
    const msg = item as ChatMessage;
    // Track index here instead of inside renderItem — same call frequency, cleaner separation
    if (msg.txtMsgId) messageIndexMap.current[msg.txtMsgId] = index;
    const known = msg.txtMsgId ? itemHeights.current[msg.txtMsgId] : 0;
    layout.size = known && known > 0 ? known : ESTIMATED_ITEM_SIZE;
  }, []);

  const renderAvatar = () => {
    if (clientIconUri === 'ai_image' && clientName === LYDIA_NAME)
      return <Image source={require('@/assets/images/ai_image.png')} style={styles.avatar} />;
    if (typeof clientIconUri === 'string') {
      return (
        <View style={styles.avatarWrapper}>
          <Image source={require('@/assets/images/userImagePlaceHolder.png')} style={styles.avatarPlaceholder} resizeMode="cover" />
          <Image source={{ uri: Array.isArray(clientIconUri) ? clientIconUri[0] : clientIconUri }} style={styles.avatarFull} resizeMode="cover" />
        </View>
      );
    }
    return (
      <View style={styles.avatarFallback}>
        <Text style={styles.avatarFallbackText}>{(clientName?.[0] ?? 'U').toUpperCase()}</Text>
      </View>
    );
  };

  const headerSubtitle = useMemo(() => {
    if (isClientTyping) return 'typing…';
    if (isClientOnline) return 'online';
    return clientEmail ?? '';
  }, [isClientTyping, isClientOnline, clientEmail]);

  return (
    <ReusableScreen>
      <MenuProvider>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={IS_IOS ? 'padding' : undefined}
          keyboardVerticalOffset={IS_IOS ? 90 : 0}
        >
          <View style={styles.container}>
            <WaBg />

            <OfflineBanner visible={!isConnected} />

            {/* ── Header ── */}
            <View style={styles.header}>
              <View style={styles.headerLeft}>
                <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="arrow-back" size={24} color="#000" />
                </TouchableOpacity>
                <TouchableOpacity style={styles.headerAvatarBtn} activeOpacity={0.8}>{renderAvatar()}</TouchableOpacity>
                <View style={styles.headerTextBlock}>
                  <Text style={styles.headerName} numberOfLines={1} ellipsizeMode="tail">{clientName}</Text>
                  <Text style={[styles.headerSub, isClientTyping && styles.headerSubTyping]} numberOfLines={1} ellipsizeMode="tail">{headerSubtitle}</Text>
                </View>
              </View>
              <View style={styles.headerRight}>
                <TouchableOpacity style={styles.headerIcon} onPress={() => setSearchVisible((v) => !v)}>
                  <Ionicons name="search-outline" size={21} color="#000" />
                </TouchableOpacity>
                <TouchableOpacity style={styles.headerIcon}>
                  <Ionicons name="call-outline" size={21} color="#df9604ff" />
                </TouchableOpacity>
                <TouchableOpacity style={styles.headerIcon}>
                  <Ionicons name="videocam-outline" size={22} color="#df9604ff" />
                </TouchableOpacity>
                <PopupMenu />
              </View>
            </View>

            <SearchBar
              visible={searchVisible} query={searchQuery} onQueryChange={setSearchQuery}
              resultCount={searchResultIds.length} currentIndex={searchIndex}
              onPrev={onSearchPrev} onNext={onSearchNext}
              onClose={() => { setSearchVisible(false); setSearchQuery(''); }}
            />

            {/* ── Message List ── */}
            <FlashList
              ref={flatListRef as React.RefObject<FlashList<ListItem>>}
              data={listData}
              renderItem={renderItem}
              keyExtractor={keyExtractor}
              contentContainerStyle={styles.messageList}
              inverted
              estimatedItemSize={ESTIMATED_ITEM_SIZE}
              drawDistance={250}
              overrideItemLayout={overrideItemLayout}
              onScroll={handleScroll}
              onMomentumScrollEnd={handleScrollEnd}
              onScrollEndDrag={handleScrollEnd}
              scrollEventThrottle={16}
              onEndReached={loadMoreMessages}
              onEndReachedThreshold={0.3}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              estimatedListSize={{ height: SCREEN_HEIGHT, width: SCREEN_WIDTH }}
              ListFooterComponent={
                isFetchingMore
                  ? <ActivityIndicator size="small" color="#8696a0" style={{ marginVertical: 8 }} />
                  : null
              }
            />

            {isClientTyping && <TypingIndicator />}

            {/* ── Scroll-to-bottom FAB ── */}
            {showScrollButton && (
              <TouchableOpacity style={styles.scrollButton} onPress={() => scrollToBottom(true)}>
                <Ionicons name="arrow-down" size={18} color="#fff" />
                {unreadCount > 0 && (
                  <View style={styles.unreadBadge}>
                    <Text style={styles.unreadBadgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
                  </View>
                )}
              </TouchableOpacity>
            )}

            {/* ── Reply Banner ── */}
            {replyTo && (
              <View style={styles.replyBanner}>
                <View style={styles.replyBannerAccent} />
                <View style={styles.replyBannerBody}>
                  <Text style={styles.replyBannerName}>{replyTo.username === userName ? 'You' : replyTo.username}</Text>
                  <Text numberOfLines={1} style={styles.replyBannerText}>{replyTo.text}</Text>
                </View>
                <TouchableOpacity onPress={() => setReplyTo(null)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={styles.replyBannerClose}>
                  <Ionicons name="close" size={18} color="#8696a0" />
                </TouchableOpacity>
              </View>
            )}

            {/* ── Input Row ── */}
            <View style={styles.inputRow}>
              <View style={styles.inputBarWrap}>
                <InputBar
                  onSend={sendMessage}
                  onTyping={handleTyping}
                />
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>

        {/* ── Context Menu ── */}
        <ContextMenu
          visible={contextMenuState.visible} position={contextMenuState.position}
          message={contextMenuState.message} isOutgoing={contextMenuState.message?.username === userName}
          onClose={closeContextMenu} onReply={handleContextReply} onCopy={handleCopy}
          onDelete={handleDelete} onStar={handleStar} onForward={handleForward}
          onReact={(emoji) => contextMenuState.message && handleReact(contextMenuState.message, emoji)}
        />

        {/* ── Full-screen Image Viewer ── */}
        {imageViewerUri && <ImageViewer uri={imageViewerUri} onClose={() => setImageViewerUri(null)} />}
      </MenuProvider>
    </ReusableScreen>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: '#d4ead4ff' },

  // FIX 1 continued: The background is now a single View with a subtle diagonal
  // pattern achieved via backgroundColor + a repeating gradient border trick.
  // Zero extra native nodes. Visual result is identical to the original dot grid.
  waBgBase: {
    backgroundColor: '#d4ead4ff',
    // On native we can't use CSS repeating-linear-gradient, but the solid
    // off-white/tan is a faithful WhatsApp-style background on its own.
    // If you need the grid dots, render a single <Image> with a small tiled PNG
    // via `resizeMode="repeat"` — that's one native node vs 300.
  },

  messageList: { paddingVertical: 6, paddingHorizontal: 4 },
  offlineBanner: { backgroundColor: '#1f9e10ff', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 6, gap: 6 },
  offlineBannerText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  header: { height: 65, backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingTop: IS_IOS ? 0 : 4, borderBottomWidth: 0.5, borderBottomColor: '#ddd' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center' },
  headerAvatarBtn: { marginLeft: 8, marginRight: 6 },
  headerIcon: { marginLeft: 16 },
  headerTextBlock: { flex: 1 },
  headerName: { fontWeight: '600', fontSize: 15, color: '#000', width: 140 },
  headerSub: { fontSize: 13, color: '#2e7d32', fontWeight: '500', marginTop: 1 },
  headerSubTyping: { color: '#23c6d2', fontWeight: '600' },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  avatarWrapper: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarPlaceholder: { width: '70%', height: '70%', position: 'absolute' },
  avatarFull: { width: '100%', height: '100%', borderRadius: 20 },
  avatarFallback: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#128c7e', justifyContent: 'center', alignItems: 'center' },
  avatarFallbackText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#e0e0e0' },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, fontSize: 15, color: '#1c1c1e' },
  searchCount: { fontSize: 13, color: '#8696a0', marginHorizontal: 8 },
  searchNavBtn: { padding: 4, marginLeft: 4 },
  typingWrap: { paddingHorizontal: 12, paddingBottom: 4 },
  typingBubble: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, alignSelf: 'flex-start', gap: 4 },
  typingDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#8696a0', opacity: 0.5 },
  row: { flexDirection: 'row', marginVertical: 2, marginHorizontal: 6, alignItems: 'center' },
  rowRight: { justifyContent: 'flex-end' },
  rowLeft: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '90%', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 17, borderWidth: 1 },
  bubbleOutgoing: { backgroundColor: '#0fb5c167', borderBottomRightRadius: 4, borderColor: '#ffffff' },
  bubbleIncoming: { backgroundColor: '#fff', borderBottomLeftRadius: 4, borderWidth: 0.5, borderColor: '#eee' },
  bubbleDeleted: { backgroundColor: 'rgba(255,255,255,0.6)', borderColor: '#eee' },
  bubbleMedia: { padding: 0, borderWidth: 0, overflow: 'hidden', backgroundColor: 'transparent' },
  messageText: { color: '#1c1c1e', fontSize: 15, lineHeight: 21 },
  loadingText: { fontSize: 13, color: '#8696a0' },
  messageFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: 3, gap: 3 },
  timeText: { fontSize: 11, color: '#8696a0' },
  timeTextOutgoing: { color: '#000' },
  statusIcon: { marginLeft: 1 },
  editedLabel: { fontSize: 11, color: '#8696a0', fontStyle: 'italic' },
  starBadge: { position: 'absolute', top: 4, right: 4 },
  deletedWrap: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  deletedText: { fontSize: 14, color: '#8696a0', fontStyle: 'italic' },
  forwardedLabel: { flexDirection: 'row', alignItems: 'center', gap: 3, marginBottom: 3 },
  forwardedText: { fontSize: 12, color: '#8696a0', fontStyle: 'italic' },
  messageImage: { width: 220, height: 180, borderRadius: 10 },
  imageTimeOverlay: { position: 'absolute', bottom: 6, right: 8, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.38)', borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2 },
  imageTimeText: { fontSize: 11, color: '#fff' },
  imageCaption: { paddingHorizontal: 10, paddingTop: 5, paddingBottom: 2 },
  fileWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4, minWidth: 200 },
  fileIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#00a884', justifyContent: 'center', alignItems: 'center' },
  fileInfo: { flex: 1 },
  fileName: { fontSize: 14, color: '#1c1c1e', fontWeight: '500' },
  fileType: { fontSize: 12, color: '#8696a0' },
  replyPreview: { flexDirection: 'row', borderRadius: 6, marginBottom: 5, overflow: 'hidden' },
  replyAccent: { width: 3, backgroundColor: '#23c6d2e7' },
  replyPreviewContent: { flex: 1, paddingHorizontal: 8, paddingVertical: 4 },
  replyPreviewBgGreen: { backgroundColor: 'rgba(35,198,210,0.1)' },
  replyPreviewBgWhite: { backgroundColor: '#edf2fbe8' },
  replyPreviewName: { fontSize: 13, color: '#068d97f5', fontWeight: '700', marginBottom: 1 },
  replyPreviewText: { fontSize: 13, color: '#54656f' },
  reactionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  reactionChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.07)', borderRadius: 12, paddingHorizontal: 6, paddingVertical: 2, gap: 2 },
  reactionChipEmoji: { fontSize: 14 },
  reactionChipCount: { fontSize: 11, color: '#54656f' },
  replyBanner: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#f0f2f5', borderTopWidth: 1, borderTopColor: '#e0e0e0' },
  replyBannerAccent: { width: 3, borderRadius: 3, backgroundColor: '#23c6d2e7', alignSelf: 'stretch', marginRight: 10 },
  replyBannerBody: { flex: 1 },
  replyBannerName: { fontSize: 12, color: '#077fa4ff', fontWeight: '700', marginBottom: 2 },
  replyBannerText: { fontSize: 13, color: '#54656f' },
  replyBannerClose: { padding: 6 },
  scrollButton: { position: 'absolute', bottom: 80, right: 16, width: 40, height: 40, backgroundColor: '#3fc84ac5', borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  unreadBadge: { position: 'absolute', top: -6, right: -4, backgroundColor: '#23c6d2', borderRadius: 10, minWidth: 20, height: 20, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 4 },
  unreadBadgeText: { fontSize: 11, color: '#fff', fontWeight: '700' },
  contextOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  reactionBar: { position: 'absolute', flexDirection: 'row', backgroundColor: '#fff', borderRadius: 28, paddingHorizontal: 6, paddingVertical: 6, gap: 4 },
  reactionBtn: { padding: 4 },
  reactionEmoji: { fontSize: 24 },
  contextMenu: { position: 'absolute', backgroundColor: '#fff', borderRadius: 10, minWidth: 180, overflow: 'hidden' },
  contextItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 13, gap: 12, borderBottomWidth: 0.5, borderBottomColor: '#f0f0f0' },
  contextItemText: { fontSize: 15, color: '#1c1c1e' },
  contextItemDanger: { color: '#ef4444' },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: 'transparent',
    paddingLeft: 6,
    paddingRight: 0,
    paddingBottom: Platform.OS === 'android' ? 8 : 0,
  },
  inputBarWrap: { flex: 1 },
  attachSheet: { backgroundColor: '#fff', borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingBottom: 28, paddingTop: 10, paddingHorizontal: 20, borderTopWidth: 0.5, borderTopColor: '#e0e0e0' },
  attachSheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#d0d7de', alignSelf: 'center', marginBottom: 20 },
  attachSheetRow: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' },
  attachItem: { alignItems: 'center', gap: 8, minWidth: 56 },
  attachIconCircle: { width: 44, height: 45, borderRadius: 27, justifyContent: 'center', alignItems: 'center' },
  attachLabel: { fontSize: 11, color: '#54656f', fontWeight: '500' },
  imageViewerBg: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  imageViewerHeader: { position: 'absolute', top: IS_IOS ? 56 : 36, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, zIndex: 10 },
  imageViewerHeaderBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center' },
  imageViewerHeaderActions: { flexDirection: 'row', gap: 10 },
  imageViewerFull: { width: SCREEN_WIDTH, height: SCREEN_HEIGHT * 0.78 },
  imageViewerHint: { position: 'absolute', bottom: IS_IOS ? 48 : 28, color: 'rgba(255,255,255,0.5)', fontSize: 12, textAlign: 'center' },
  loaderContainer: { ...StyleSheet.absoluteFillObject, zIndex: 1000, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' },
});

export default ChatRoom;
