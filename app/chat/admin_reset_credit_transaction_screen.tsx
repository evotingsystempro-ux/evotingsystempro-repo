/**
 * admin_wallet_transaction_screen.tsx
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, {
  useCallback, useContext, useEffect, useMemo, useRef, useState,
} from "react";
import {
  ActivityIndicator, Clipboard, Modal, Platform, Pressable,
  RefreshControl, ScrollView, StyleSheet,
  Text, TextInput, TouchableHighlight, TouchableOpacity, View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import {
  collection, doc, getDocs, getDoc, limit, orderBy, query,
  serverTimestamp, startAfter, updateDoc, where,
  QueryDocumentSnapshot,
} from "firebase/firestore";
import { db } from "@/firebase";
import { GlobalContext } from "@/context";
import ReusableScreen from "@/components/ReusableScreen";

/* ─── Constants ──────────────────────────────────────────────────────────── */
const ADMIN_EMAIL = "stanleyafon@gmail.com";
const WALLET_TX_DB = "TRANSACTION_WALLET_DB";
const WALLET_DB = "WALLET_DB";
const PAGE_SIZE = 10;

const CACHE_KEY = "admin_wallet_tx_v2_records";
const CURSOR_KEY = "admin_wallet_tx_v2_cursor_id";

/* ─── Design tokens ──────────────────────────────────────────────────────── */
const T = {
  bg: "#F5F4F2",
  surface: "#FFFFFF",
  surfaceRaised: "#FAFAF9",
  border: "#EBEBEA",
  borderStrong: "#D5D4D2",
  ink: "#18181B",
  inkMid: "#52525B",
  inkMuted: "#A1A1AA",

  accent: "#EA580C",
  accentSoft: "#FFF7ED",
  accentMid: "#FDBA74",
  accentText: "#C2410C",

  amber: "#D97706",
  amberSoft: "#FFFBEB",
  amberMid: "#FCD34D",
  amberText: "#92400E",

  emerald: "#059669",
  emeraldSoft: "#ECFDF5",
  emeraldMid: "#6EE7B7",
  emeraldText: "#065F46",

  rose: "#E11D48",
  roseSoft: "#FFF1F2",
  roseMid: "#FDA4AF",
  roseText: "#9F1239",

  blue: "#2563EB",
  blueSoft: "#EFF6FF",
  blueMid: "#BFDBFE",
  blueText: "#1E3A8A",

  subscriptionColor: "#7C3AED",
  subscriptionBg: "#F5F3FF",
  subscriptionBorder: "#C4B5FD",

  monthlyColor: "#16A34A",
  monthlyBg: "#DCFCE7",
  monthlyBorder: "#86EFAC",

  paygColor: "#0891B2",
  paygBg: "#E0F2FE",
  paygBorder: "#7DD3FC",

  sp1: 4, sp2: 8, sp3: 12, sp4: 16, sp5: 20, sp6: 24,
  radiusSm: 8, radiusMd: 12, radiusLg: 16, radiusXl: 20, radiusFull: 999,
} as const;

/* ─── Types ──────────────────────────────────────────────────────────────── */
type TxStatus = "pending approval" | "completed" | "failed" | "cancelled";

type TxType =
  | "deposit"
  | "withdrawal"
  | "P2P_money_transfer"
  | "credit_purchase"
  | "subscription_purchase"
  | "credit_quiz_reward";

type SubscriptionSubType = "monthly" | null;

interface WalletTx {
  id: string;
  email?: string;
  name?: string;
  transaction_id?: string;
  external_transaction_id?: string;
  transaction_type: TxType;
  transaction_status: TxStatus | string;
  transaction_amount: number | null;
  current_balance: number | null;
  previous_balance: number | null;
  currency?: string;
  payment_method?: string;
  note?: string;
  createdAt: any;
  updatedAt?: any;
  counterpartyEmail?: string;
  counterpartyName?: string;
  accountStatus?: string;
  adminNote?: string | null;
  reviewedAt?: number | null;
  reviewedBy?: string | null;
  subscription_snapshot?: {
    plan: "monthly";
    expires_at: number;
    stacked: boolean;
    total_purchases: number;
  };
  credit_snapshot?: {
    plan: "payg";
    credits_purchased: number;
    credits_total_after: number;
    price_per_credit: number;
  };
}

interface WalletDoc {
  email: string;
  free_reset_credit: number;
  monthly_subscription_plan: {
    expires_at: number | null;
    is_active: boolean;
    is_suspended: boolean;
    last_purchased_at: number | null;
    started_at: number | null;
    suspension_started_at: number | null;
    total_purchases: number;
  };
  pay_as_you_go: {
    date_subscribed: number | null;
  };
  plan_id: string;
  transaction_type: string;
  previous_balance: number | null;
  current_balance: number | null;
  transaction_amount: number | null;
  currency: string;
  payment_method: string;
  createdAt: any;
}

/* ─── Config maps ────────────────────────────────────────────────────────── */
const STATUS_CFG: Record<string, {
  label: string; color: string; soft: string; mid: string; text: string; icon: string;
}> = {
  "pending approval": {
    label: "Pending", color: T.amber, soft: T.amberSoft, mid: T.amberMid,
    text: T.amberText, icon: "time-outline",
  },
  completed: {
    label: "Completed", color: T.emerald, soft: T.emeraldSoft, mid: T.emeraldMid,
    text: T.emeraldText, icon: "checkmark-circle-outline",
  },
  failed: {
    label: "Failed", color: T.rose, soft: T.roseSoft, mid: T.roseMid,
    text: T.roseText, icon: "close-circle-outline",
  },
  cancelled: {
    label: "Cancelled", color: T.inkMid, soft: T.bg, mid: T.border,
    text: T.inkMid, icon: "remove-circle-outline",
  },
};

const TYPE_CFG: Record<TxType, { label: string; icon: string; amountSign: "+" | "-" }> = {
  deposit: { label: "Deposit", icon: "arrow-down-circle-outline", amountSign: "+" },
  withdrawal: { label: "Withdrawal", icon: "arrow-up-circle-outline", amountSign: "-" },
  P2P_money_transfer: { label: "P2P Transfer", icon: "swap-horizontal-outline", amountSign: "-" },
  credit_purchase: { label: "Pay As You Go", icon: "flash-outline", amountSign: "-" },
  subscription_purchase: { label: "Subscription", icon: "ribbon-outline", amountSign: "-" },
  credit_quiz_reward: { label: "Quiz Reward", icon: "trophy-outline", amountSign: "+" },
};

const METHOD_LABEL: Record<string, string> = {
  momo: "Mobile Money", eth: "Ethereum", binance: "Binance Pay", stanbic: "Stanbic Bank",
  "system transfer": "System Transfer",
};

const ALL_STATUSES: TxStatus[] = ["pending approval", "completed", "failed", "cancelled"];

/* ─── Subscription helpers ───────────────────────────────────────────────── */
function resolveSubPlanFromNote(note?: string): SubscriptionSubType {
  if (!note) return null;
  return note.toLowerCase().includes("month") ? "monthly" : null;
}

function resolveSubscriptionSubType(tx: WalletTx): SubscriptionSubType {
  if (tx.transaction_type !== "subscription_purchase") return null;
  if (tx.subscription_snapshot?.plan) return tx.subscription_snapshot.plan;
  return resolveSubPlanFromNote(tx.note);
}

function subscriptionLabel(subType: SubscriptionSubType): string {
  return subType === "monthly" ? "Monthly Plan" : "Subscription";
}
function subscriptionColor(subType: SubscriptionSubType): string {
  return subType === "monthly" ? T.monthlyColor : T.subscriptionColor;
}
function subscriptionBg(subType: SubscriptionSubType): string {
  return subType === "monthly" ? T.monthlyBg : T.subscriptionBg;
}
function subscriptionBorder(subType: SubscriptionSubType): string {
  return subType === "monthly" ? T.monthlyBorder : T.subscriptionBorder;
}

/* ─── Display helpers ────────────────────────────────────────────────────── */
function txLabel(tx: WalletTx): string {
  switch (tx.transaction_type) {
    case "deposit": return "Deposit";
    case "withdrawal": return "Withdrawal";
    case "P2P_money_transfer": return "P2P Transfer";
    case "credit_purchase": return "Pay As You Go";
    case "subscription_purchase": return subscriptionLabel(resolveSubscriptionSubType(tx));
    case "credit_quiz_reward": return "Quiz Reward";
    default: return tx.transaction_type ?? "Transaction";
  }
}

function txIcon(tx: WalletTx): string {
  switch (tx.transaction_type) {
    case "deposit": return "arrow-down-circle-outline";
    case "withdrawal": return "arrow-up-circle-outline";
    case "P2P_money_transfer": return "swap-horizontal-outline";
    case "credit_purchase": return "flash-outline";
    case "credit_quiz_reward": return "trophy-outline";
    case "subscription_purchase": {
      const plan = tx.subscription_snapshot?.plan ?? resolveSubPlanFromNote(tx.note);
      return plan === "monthly" ? "calendar-outline" : "ribbon-outline";
    }
    default: return "receipt-outline";
  }
}

function txAmountColor(tx: WalletTx): string {
  switch (tx.transaction_type) {
    case "deposit":
    case "credit_quiz_reward":
      return T.emerald;
    case "credit_purchase": return T.paygColor;
    case "subscription_purchase": return subscriptionColor(resolveSubscriptionSubType(tx));
    default: return T.rose;
  }
}

function txAmountPrefix(tx: WalletTx): "+" | "-" {
  return (tx.transaction_type === "deposit" || tx.transaction_type === "credit_quiz_reward")
    ? "+"
    : "-";
}

function resolveDisplayAmount(tx: WalletTx): number {
  return tx.transaction_amount ?? tx.current_balance ?? 0;
}

/* ─── Pure helpers ────── */
const fmtDate = (ts: any): string => {
  if (!ts) return "—";
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
};

const fmtShort = (ts: any): string => {
  if (!ts) return "—";
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("en-GB", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
};

const formatGHS = (v: number) =>
  `GHS ${v.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function tsToMs(ts: any): number {
  if (!ts) return 0;
  if (typeof ts.toDate === "function") return ts.toDate().getTime();
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts === "number") return ts;
  const p = Date.parse(ts);
  return isNaN(p) ? 0 : p;
}

function mergeRecords(existing: WalletTx[], incoming: WalletTx[]): WalletTx[] {
  const map = new Map<string, WalletTx>();
  for (const r of existing) map.set(r.id, r);
  for (const r of incoming) map.set(r.id, r);
  return Array.from(map.values()).sort((a, b) => tsToMs(b.createdAt) - tsToMs(a.createdAt));
}

/* ─── AsyncStorage helpers ─────── */
async function readCache(): Promise<WalletTx[]> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

async function writeCache(data: WalletTx[]): Promise<void> {
  try { await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch { }
}

async function readCursorDocId(): Promise<string | null> {
  try { return await AsyncStorage.getItem(CURSOR_KEY); } catch { return null; }
}

async function saveCursorDocId(docId: string): Promise<void> {
  try { await AsyncStorage.setItem(CURSOR_KEY, docId); } catch { }
}

async function clearAllCache(): Promise<void> {
  try { await AsyncStorage.multiRemove([CACHE_KEY, CURSOR_KEY]); } catch { }
}

/* ─── Firestore fetch helpers ────────────────────────────────────────────── */
async function fetchPage(
  cursorDoc: QueryDocumentSnapshot | null,
): Promise<{ records: WalletTx[]; lastDoc: QueryDocumentSnapshot | null }> {
  const constraints: Parameters<typeof query>[1][] = [
    orderBy("createdAt", "desc"),
    limit(PAGE_SIZE),
  ];
  if (cursorDoc) constraints.push(startAfter(cursorDoc));

  const snap = await getDocs(
    query(collection(db, WALLET_TX_DB), ...constraints)
  );

  const records: WalletTx[] = snap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<WalletTx, "id">),
  }));

  const lastDoc = snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : null;
  return { records, lastDoc };
}

async function rehydrateCursor(docId: string): Promise<QueryDocumentSnapshot | null> {
  try {
    const snap = await getDoc(doc(db, WALLET_TX_DB, docId));
    if (!snap.exists()) return null;
    return snap as unknown as QueryDocumentSnapshot;
  } catch { return null; }
}

async function readWalletBalance(userEmail: string): Promise<number> {
  try {
    const snap = await getDoc(doc(db, WALLET_DB, userEmail));
    if (!snap.exists()) return 0;
    return (snap.data() as WalletDoc).current_balance ?? 0;
  } catch (err) {
    console.warn("[AdminTx] readWalletBalance:", err);
    return 0;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   ToastBanner — cross-platform, no Alert dependency
   Variants: success | error | info | warning
   Auto-dismisses after 3 s; tap to dismiss early.
═══════════════════════════════════════════════════════════════════════════ */
type ToastType = "success" | "error" | "info" | "warning";

interface ToastProps { message: string; type: ToastType; onDismiss: () => void; }

function ToastBanner({ message, type, onDismiss }: ToastProps) {
  const palette: Record<ToastType, { bg: string; border: string; color: string; icon: string }> = {
    success: { bg: T.emeraldSoft, border: T.emeraldMid, color: T.emeraldText, icon: "checkmark-circle" },
    error: { bg: T.roseSoft, border: T.roseMid, color: T.roseText, icon: "close-circle" },
    info: { bg: T.blueSoft, border: T.blueMid, color: T.blueText, icon: "information-circle" },
    warning: { bg: T.amberSoft, border: T.amberMid, color: T.amberText, icon: "alert-circle" },
  };
  const p = palette[type];

  return (
    <TouchableOpacity
      style={[ts.wrap, { backgroundColor: p.bg, borderColor: p.border }]}
      onPress={onDismiss}
      activeOpacity={0.85}
      accessibilityRole="alert"
      accessibilityLabel={message}
    >
      <Ionicons name={p.icon as any} size={18} color={p.color} />
      <Text style={[ts.text, { color: p.color }]}>{message}</Text>
      <Ionicons name="close-outline" size={16} color={p.color} style={{ opacity: 0.6 }} />
    </TouchableOpacity>
  );
}

const ts = StyleSheet.create({
  wrap: {
    position: "absolute", bottom: 30, left: 16, right: 16,
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 16, paddingVertical: 14,
    borderRadius: T.radiusMd, borderWidth: 1, zIndex: 9999,
    /* web box-shadow substitute via borderWidth already present */
  },
  text: { fontSize: 14, fontWeight: "600", flex: 1, lineHeight: 20 },
});

/* ═══════════════════════════════════════════════════════════════════════════
   ConfirmDialog — cross-platform replacement for Alert.alert
   Renders inside a Modal so it sits above everything on iOS, Android, & Web.
   onCancel is optional; omit it for single-button (informational) dialogs.
═══════════════════════════════════════════════════════════════════════════ */
interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  message: string;
  /** Label for the primary (destructive / affirmative) action. Default: "Confirm" */
  confirmLabel?: string;
  /** When omitted the dialog shows only a single "OK" button. */
  cancelLabel?: string;
  /** Visual weight of confirm button: "default" | "destructive" | "primary" */
  confirmVariant?: "default" | "destructive" | "primary";
  onConfirm: () => void;
  onCancel?: () => void;
  /** Extra note rendered in a muted pill under the message — useful for caveats. */
  note?: string;
}

function ConfirmDialog({
  visible, title, message,
  confirmLabel = "Confirm", cancelLabel = "Cancel",
  confirmVariant = "default",
  onConfirm, onCancel,
  note,
}: ConfirmDialogProps) {
  const confirmBg =
    confirmVariant === "destructive" ? T.rose
      : confirmVariant === "primary" ? T.accent
        : T.ink;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel ?? onConfirm}>
      <Pressable style={cd.overlay} onPress={onCancel ?? onConfirm}>
        <Pressable style={cd.sheet} onPress={(e) => e.stopPropagation()}>
          {/* Icon row */}
          <View style={[
            cd.iconCircle,
            confirmVariant === "destructive" && { backgroundColor: T.roseSoft },
            confirmVariant === "primary" && { backgroundColor: T.accentSoft },
          ]}>
            <Ionicons
              name={
                confirmVariant === "destructive" ? "warning-outline"
                  : confirmVariant === "primary" ? "checkmark-circle-outline"
                    : "help-circle-outline"
              }
              size={26}
              color={
                confirmVariant === "destructive" ? T.rose
                  : confirmVariant === "primary" ? T.accent
                    : T.inkMid
              }
            />
          </View>

          <Text style={cd.title}>{title}</Text>
          <Text style={cd.message}>{message}</Text>

          {!!note && (
            <View style={cd.noteBox}>
              <Ionicons name="information-circle-outline" size={13} color={T.inkMuted} />
              <Text style={cd.noteText}>{note}</Text>
            </View>
          )}

          <View style={[cd.btnRow, !onCancel && { justifyContent: "center" }]}>
            {!!onCancel && (
              <TouchableOpacity style={cd.cancelBtn} onPress={onCancel} activeOpacity={0.75}>
                <Text style={cd.cancelText}>{cancelLabel}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[cd.confirmBtn, { backgroundColor: confirmBg }, !onCancel && { flex: 0, paddingHorizontal: 40 }]}
              onPress={onConfirm}
              activeOpacity={0.8}
            >
              <Text style={cd.confirmText}>{confirmLabel}</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const cd = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  sheet: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: T.surface,
    borderRadius: T.radiusXl,
    paddingHorizontal: T.sp5,
    paddingTop: T.sp5,
    paddingBottom: T.sp4,
    alignItems: "center",
  },
  iconCircle: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: T.bg,
    justifyContent: "center", alignItems: "center",
    marginBottom: T.sp3,
  },
  title: {
    fontSize: 17, fontWeight: "700", color: T.ink,
    textAlign: "center", marginBottom: 8,
  },
  message: {
    fontSize: 14, color: T.inkMid, textAlign: "center",
    lineHeight: 21, marginBottom: T.sp3,
  },
  noteBox: {
    flexDirection: "row", alignItems: "flex-start", gap: 6,
    backgroundColor: T.bg, borderRadius: T.radiusSm,
    paddingHorizontal: 12, paddingVertical: 9,
    marginBottom: T.sp3, alignSelf: "stretch",
    borderWidth: 1, borderColor: T.border,
  },
  noteText: {
    fontSize: 12, color: T.inkMuted, lineHeight: 17, flex: 1,
  },
  btnRow: {
    flexDirection: "row", gap: T.sp2, alignSelf: "stretch", marginTop: T.sp1,
  },
  cancelBtn: {
    flex: 1, paddingVertical: 13, borderRadius: T.radiusMd,
    backgroundColor: T.bg, borderWidth: 1, borderColor: T.border,
    alignItems: "center",
  },
  cancelText: { fontSize: 14, fontWeight: "600", color: T.inkMid },
  confirmBtn: {
    flex: 1, paddingVertical: 13, borderRadius: T.radiusMd, alignItems: "center",
  },
  confirmText: { fontSize: 14, fontWeight: "700", color: "#fff" },
});

/* ─── Sub-components ─────────────────────────────────────────────────────── */
function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CFG[status] ?? STATUS_CFG["pending approval"];
  return (
    <View style={[ss.badge, { backgroundColor: cfg.soft }]}>
      <View style={[ss.badgeDot, { backgroundColor: cfg.color }]} />
      <Text style={[ss.badgeText, { color: cfg.text }]}>{cfg.label}</Text>
    </View>
  );
}

function KpiCard({ label, value, icon, color, urgent }: {
  label: string; value: string; icon: string; color: string; urgent?: boolean;
}) {
  return (
    <View style={[ss.kpiCard, urgent && { borderColor: color + "66" }]}>
      {urgent && <View style={[ss.kpiUrgentDot, { backgroundColor: color }]} />}
      <View style={[ss.kpiIconWrap, { backgroundColor: color + "18" }]}>
        <Ionicons name={icon as any} size={14} color={color} />
      </View>
      <Text style={[ss.kpiValue, { color }]}>{value}</Text>
      <Text style={ss.kpiLabel}>{label}</Text>
    </View>
  );
}

function FilterPill({ label, active, color, soft, text, onPress }: {
  label: string; active: boolean;
  color: string; soft: string; text: string; onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[ss.pill, active && { backgroundColor: soft, borderColor: color + "55" }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {active && <View style={[ss.pillDot, { backgroundColor: color }]} />}
      <Text style={[ss.pillText, active && { color: text, fontWeight: "600" }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function DetailRow({ label, value, valueColor }: {
  label: string; value: string; valueColor?: string;
}) {
  return (
    <View style={ss.detailRow}>
      <Text style={ss.detailLabel}>{label}</Text>
      <Text style={[ss.detailValue, valueColor ? { color: valueColor } : undefined]} numberOfLines={10}>
        {value}
      </Text>
    </View>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    Clipboard.setString(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  return (
    <View style={ss.detailRow}>
      <Text style={ss.detailLabel}>{label}</Text>
      <TouchableOpacity style={ss.copyTarget} onPress={copy} activeOpacity={0.65}>
        <Text style={ss.detailMono} numberOfLines={1} ellipsizeMode="middle">{value || "—"}</Text>
        <Ionicons
          name={copied ? "checkmark-circle" : "copy-outline"}
          size={14}
          color={copied ? T.emerald : T.inkMuted}
          style={{ marginLeft: 6 }}
        />
      </TouchableOpacity>
    </View>
  );
}

/* ─── Load More Footer ───────────────────────────────────────────────────── */
function LoadMoreFooter({
  loading, allLoaded, loadedCount, onPress,
}: {
  loading: boolean; allLoaded: boolean; loadedCount: number; onPress: () => void;
}) {
  if (allLoaded) {
    return (
      <View style={ss.allLoadedFooter}>
        <View style={ss.allLoadedLine} />
        <Text style={ss.allLoadedText}>All {loadedCount} records loaded</Text>
        <View style={ss.allLoadedLine} />
      </View>
    );
  }

  return (
    <View style={ss.loadMoreContainer}>
      <View style={ss.loadMoreDivider} />
      {loading ? (
        <View style={ss.loadMoreLoadingRow}>
          <ActivityIndicator size="small" color={T.accent} />
          <Text style={ss.loadMoreLoadingText}>Loading next {PAGE_SIZE} records…</Text>
        </View>
      ) : (
        <TouchableOpacity style={ss.loadMoreButton} onPress={onPress} activeOpacity={0.78}>
          <Ionicons name="chevron-down-circle-outline" size={16} color={T.accent} />
          <Text style={ss.loadMoreButtonText}>Load more records</Text>
          <View style={ss.loadMoreBadge}>
            <Text style={ss.loadMoreBadgeText}>{loadedCount} loaded</Text>
          </View>
        </TouchableOpacity>
      )}
    </View>
  );
}

/* ─── Status Update Modal ────────────────────────────────────────────────── */
interface StatusModalProps {
  visible: boolean;
  tx: WalletTx | null;
  currentStatus: TxStatus | string;
  adminNote: string;
  updating: boolean;
  reviewerName: string;
  onClose: () => void;
  onStatusChange: (s: TxStatus) => void;
  onNoteChange: (n: string) => void;
  onConfirm: () => void;
}

function StatusUpdateModal({
  visible, tx, currentStatus, adminNote, updating,
  reviewerName, onClose, onStatusChange, onNoteChange, onConfirm,
}: StatusModalProps) {
  if (!tx) return null;
  const cfg = STATUS_CFG[currentStatus] ?? STATUS_CFG["pending approval"];
  const displayAmt = resolveDisplayAmount(tx);
  const subType = resolveSubscriptionSubType(tx);
  const isSubscription = tx.transaction_type === "subscription_purchase";
  const isPayg = tx.transaction_type === "credit_purchase";
  const label = txLabel(tx);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Pressable style={ss.modalOverlay} onPress={onClose}>
        <Pressable style={ss.modalSheet} onPress={(e) => e.stopPropagation()}>
          <View style={ss.modalHandle} />

          <View style={ss.modalTitleRow}>
            <View>
              <Text style={ss.modalTitle}>Update Transaction Status</Text>
              <Text style={ss.modalSub} numberOfLines={1}>{tx.email}</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={ss.modalCloseBtn}>
              <Ionicons name="close" size={20} color={T.inkMid} />
            </TouchableOpacity>
          </View>

          <View style={ss.modalSummary}>
            <Text style={ss.modalSummaryAmount}>{formatGHS(displayAmt)}</Text>
            <Text style={ss.modalSummaryType}>
              {label}
              {tx.payment_method ? ` · ${METHOD_LABEL[tx.payment_method] ?? tx.payment_method}` : ""}
            </Text>
            {isSubscription && tx.subscription_snapshot?.stacked && (
              <Text style={[ss.modalSummaryType, { color: subscriptionColor(subType) }]}>
                Extended · Expires {fmtDate(tx.subscription_snapshot.expires_at)}
              </Text>
            )}
            {isPayg && tx.credit_snapshot?.credits_purchased != null && (
              <Text style={[ss.modalSummaryType, { color: T.paygColor }]}>
                {tx.credit_snapshot.credits_purchased} credits purchased
              </Text>
            )}
            <StatusBadge status={tx.transaction_status} />
          </View>

          {tx.transaction_type === "deposit" && currentStatus === "completed" && (
            <View style={ss.approvalWarning}>
              <Ionicons name="information-circle-outline" size={15} color={T.blue} />
              <Text style={ss.approvalWarningText}>
                Approving reads the user's current_balance from WALLET_DB, adds
                transaction_amount, and writes the corrected balance back.
              </Text>
            </View>
          )}

          <Text style={ss.fieldLabel}>New Status</Text>
          <View style={ss.statusGrid}>
            {ALL_STATUSES.map((sv) => {
              const c = STATUS_CFG[sv];
              const active = currentStatus === sv;
              return (
                <TouchableOpacity
                  key={sv}
                  style={[ss.statusOption, active && { backgroundColor: c.soft, borderColor: c.color }]}
                  onPress={() => onStatusChange(sv)}
                  activeOpacity={0.75}
                >
                  <Ionicons name={c.icon as any} size={18} color={active ? c.color : T.inkMuted} />
                  <Text style={[ss.statusOptionText, active && { color: c.text, fontWeight: "700" }]}>
                    {c.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={[ss.fieldLabel, { marginTop: T.sp3 }]}>Admin Note (optional)</Text>
          <TextInput
            style={[ss.noteInput, Platform.OS === "web" && ({ outlineStyle: "none" } as any)]}
            value={adminNote}
            onChangeText={onNoteChange}
            placeholder="Add a note visible to the team…"
            placeholderTextColor={T.inkMuted}
            multiline
            numberOfLines={3}
          />

          <Text style={ss.reviewerLabel}>
            Reviewed by: <Text style={{ color: T.ink }}>{reviewerName}</Text>
          </Text>

          <TouchableOpacity
            style={[ss.confirmBtn, { backgroundColor: cfg.color }, updating && { opacity: 0.65 }]}
            onPress={onConfirm}
            disabled={updating}
            activeOpacity={0.8}
          >
            {updating ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <ActivityIndicator color="#fff" size="small" />
                <Text style={ss.confirmBtnText}>Updating…</Text>
              </View>
            ) : (
              <Text style={ss.confirmBtnText}>
                Confirm — Set to "{STATUS_CFG[currentStatus]?.label}"
              </Text>
            )}
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Main Screen
═══════════════════════════════════════════════════════════════════════════ */
export default function AdminWalletTransactionScreen() {
  const { userName, userId, userEmail } = useContext(GlobalContext);

  /* ── Dialog state ──────────────────────────────────────────────────────── */
  const [dialog, setDialog] = useState<{
    visible: boolean;
    title: string;
    message: string;
    note?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    confirmVariant?: ConfirmDialogProps["confirmVariant"];
    onConfirm: () => void;
    onCancel?: () => void;
  }>({
    visible: false, title: "", message: "",
    onConfirm: () => { },
  });

  const showDialog = useCallback((opts: Omit<typeof dialog, "visible">) => {
    setDialog({ ...opts, visible: true });
  }, []);

  const closeDialog = useCallback(() => {
    setDialog((prev) => ({ ...prev, visible: false }));
  }, []);

  /* ── Access guard ────────────────────────────────────────────────────── */
  useFocusEffect(
    useCallback(() => {
      if (!userName) { router.replace("/"); return; }
      const admin = (userEmail || userId || "").trim().toLowerCase();
      if (admin !== ADMIN_EMAIL) {
        showDialog({
          title: "Access Denied",
          message: "You do not have permission to view this screen.",
          confirmLabel: "Go back",
          confirmVariant: "destructive",
          onConfirm: () => { closeDialog(); router.back(); },
        });
      }
    }, [userName, userId, userEmail])
  );

  /* ── State ─────────────────────────────────────────────────────────────── */
  const [records, setRecords] = useState<WalletTx[]>([]);
  const [initializing, setInitializing] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [allLoaded, setAllLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<TxStatus | "all">("all");
  const [filterType, setFilterType] = useState<TxType | "all">("all");
  const [filterMethod, setFilterMethod] = useState<string>("all");
  const [sortNewest, setSortNewest] = useState(true);
  const [showSummary, setShowSummary] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [modalVisible, setModalVisible] = useState(false);
  const [selectedTx, setSelectedTx] = useState<WalletTx | null>(null);
  const [newStatus, setNewStatus] = useState<TxStatus>("pending approval");
  const [adminNote, setAdminNote] = useState("");
  const [updating, setUpdating] = useState(false);

  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchStatus, setBatchStatus] = useState<TxStatus>("completed");
  const [batchUpdating, setBatchUpdating] = useState(false);

  /* ── Toast ───────────────────────────────────────────────────────────── */
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const toastTimer = useRef<any>(null);

  const showToast = useCallback((message: string, type: ToastType = "success") => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, type });
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  const dismissToast = useCallback(() => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(null);
  }, []);

  const cursorRef = useRef<QueryDocumentSnapshot | null>(null);

  /* ── Core fetch + merge ──────────────────────────────────────────────── */
  const doFetch = useCallback(
    async (cursor: QueryDocumentSnapshot | null, replace: boolean): Promise<void> => {
      setLoadError(null);
      try {
        const { records: incoming, lastDoc } = await fetchPage(cursor);
        setRecords((prev) => {
          const merged = replace ? incoming : mergeRecords(prev, incoming);
          writeCache(merged);
          return merged;
        });
        if (lastDoc) {
          cursorRef.current = lastDoc;
          saveCursorDocId(lastDoc.id);
        }
        setAllLoaded(incoming.length < PAGE_SIZE);
      } catch (err) {
        console.error("[AdminTx] fetch error:", err);
        const msg = "Failed to load transactions. Tap refresh to retry.";
        setLoadError(msg);
        showToast(msg, "error");
      }
    },
    [showToast],
  );

  /* ── Mount ───────────────────────────────────────────────────────────── */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setInitializing(true);
      setAllLoaded(false);
      cursorRef.current = null;
      const cached = await readCache();
      if (!cancelled && cached.length > 0) {
        setRecords(cached);
        setInitializing(false);
      }
      await doFetch(null, false);
      const savedCursorId = await readCursorDocId();
      if (savedCursorId && !cancelled) {
        const live = await rehydrateCursor(savedCursorId);
        if (live && !cancelled) {
          cursorRef.current = live;
        } else if (!cancelled) {
          await AsyncStorage.removeItem(CURSOR_KEY);
        }
      }
      if (!cancelled) setInitializing(false);
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Load More ───────────────────────────────────────────────────────── */
  const handleLoadMore = useCallback(async () => {
    if (loadingMore || allLoaded) return;
    setLoadingMore(true);
    await doFetch(cursorRef.current, false);
    setLoadingMore(false);
  }, [loadingMore, allLoaded, doFetch]);

  /* ── Refresh ─────────────────────────────────────────────────────────── */
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setAllLoaded(false);
    cursorRef.current = null;
    setExpandedId(null);
    await clearAllCache();
    await doFetch(null, true);
    setRefreshing(false);
  }, [doFetch]);

  /* ── Modal open ──────────────────────────────────────────────────────── */
  const openModal = (tx: WalletTx, presetStatus?: TxStatus) => {
    setSelectedTx(tx);
    setNewStatus(presetStatus ?? (tx.transaction_status as TxStatus) ?? "pending approval");
    setAdminNote(tx.adminNote ?? "");
    setModalVisible(true);
  };

  /* ── Single status update ────── external_transaction_id ──────────────────────────────────────── */
  const handleStatusUpdate = async () => {
    if (!selectedTx) return;
    setUpdating(true);

    try {
      const reviewer = userName || (userEmail || userId || "admin");
      const txRef = doc(db, WALLET_TX_DB, selectedTx.id);
      const txAmount = selectedTx.transaction_amount ?? 0;
      const email = selectedTx.email ?? "";

      const BALANCE_MUTATING_TYPES: TxType[] = [
        "deposit", "withdrawal", "P2P_money_transfer",
        "credit_purchase", "subscription_purchase",
      ];

      const willMutateBalance =
        newStatus === "completed" &&
        BALANCE_MUTATING_TYPES.includes(selectedTx.transaction_type as TxType);

      let newCurrentBalance: number | undefined;
      let newPreviousBalance: number | undefined;

      if (willMutateBalance) {
        const walletCurrentBalance = await readWalletBalance(email);
        newPreviousBalance = walletCurrentBalance;
        const isCredit = selectedTx.transaction_type === "deposit";
        newCurrentBalance = isCredit
          ? walletCurrentBalance + txAmount
          : walletCurrentBalance - txAmount;

        if (!isCredit && newCurrentBalance < 0) {
          showToast(
            `Insufficient balance — wallet has ${formatGHS(walletCurrentBalance)} but transaction requires ${formatGHS(txAmount)}.`,
            "error",
          );
          setUpdating(false);
          return;
        }

        try {
          await updateDoc(doc(db, WALLET_DB, email), {
            current_balance: newCurrentBalance,
            previous_balance: newPreviousBalance,
            transaction_amount: txAmount,
            transaction_type: selectedTx.transaction_type,
            payment_method: selectedTx.payment_method ?? "",
            updatedAt: serverTimestamp(),
          });
        } catch (walletErr) {
          console.error("[AdminTx] WALLET_DB balance update failed:", walletErr);
          showToast("Balance update failed — transaction status was NOT changed.", "error");
          setUpdating(false);
          return;
        }
      }

      await updateDoc(txRef, {
        transaction_status: newStatus,
        adminNote: adminNote.trim() || null,
        reviewedAt: Date.now(),
        reviewedBy: reviewer,
        updatedAt: serverTimestamp(),
        ...(newCurrentBalance !== undefined ? { current_balance: newCurrentBalance } : {}),
        ...(newPreviousBalance !== undefined ? { previous_balance: newPreviousBalance } : {}),
      });

      setRecords((prev) =>
        prev.map((r) =>
          r.id === selectedTx.id
            ? {
              ...r,
              transaction_status: newStatus,
              adminNote: adminNote.trim() || null,
              reviewedAt: Date.now(),
              reviewedBy: reviewer,
              ...(newCurrentBalance !== undefined ? { current_balance: newCurrentBalance } : {}),
              ...(newPreviousBalance !== undefined ? { previous_balance: newPreviousBalance } : {}),
            }
            : r,
        ),
      );

      setModalVisible(false);

      const balanceNote =
        willMutateBalance && newCurrentBalance !== undefined
          ? ` · New balance: ${formatGHS(newCurrentBalance)}`
          : "";
      showToast(
        `Transaction set to "${STATUS_CFG[newStatus]?.label ?? newStatus}".${balanceNote}`,
        "success",
      );
    } catch (err) {
      console.error("[AdminTx] Status update error:", err);
      showToast("Update failed — please try again.", "error");
    } finally {
      setUpdating(false);
    }
  };

  /* ── Batch update ────────────────────────────────────────────────────── */
  const handleBatchUpdate = () => {
    if (selectedIds.size === 0) return;
    showDialog({
      title: "Batch Update",
      message: `Set ${selectedIds.size} transaction${selectedIds.size !== 1 ? "s" : ""} to "${STATUS_CFG[batchStatus]?.label}"?`,
      note: "Deposit approvals in a batch will NOT recompute WALLET_DB balances. Use single-approve for deposits.",
      confirmLabel: "Confirm",
      cancelLabel: "Cancel",
      confirmVariant: "primary",
      onCancel: closeDialog,
      onConfirm: async () => {
        closeDialog();
        setBatchUpdating(true);
        const reviewer = userName || (userEmail || userId || "admin");
        try {
          const targets = records.filter((r) => selectedIds.has(r.id));
          await Promise.all(
            targets.map((r) =>
              updateDoc(doc(db, WALLET_TX_DB, r.id), {
                transaction_status: batchStatus,
                adminNote: null,
                reviewedAt: Date.now(),
                reviewedBy: reviewer,
                updatedAt: serverTimestamp(),
              })
            )
          );
          setRecords((prev) =>
            prev.map((r) =>
              selectedIds.has(r.id)
                ? { ...r, transaction_status: batchStatus, reviewedAt: Date.now(), reviewedBy: reviewer }
                : r
            )
          );
          setSelectedIds(new Set());
          setSelectMode(false);
          showToast(`${targets.length} transaction${targets.length !== 1 ? "s" : ""} updated.`, "success");
        } catch {
          showToast("Batch update failed.", "error");
        } finally {
          setBatchUpdating(false);
        }
      },
    });
  };

  /* ── Derived / filtered data ─────────────────────────────────────────── */
  const uniqueMethods = useMemo(() =>
    ["all", ...Array.from(new Set(
      records.map((r) => r.payment_method).filter(Boolean) as string[]
    ))],
    [records]
  );

  const uniqueTypes = useMemo(() =>
    ["all", ...Array.from(new Set(records.map((r) => r.transaction_type)))] as (TxType | "all")[],
    [records]
  );

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return records
      .filter((r) => {
        if (filterStatus !== "all" && r.transaction_status !== filterStatus) return false;
        if (filterType !== "all" && r.transaction_type !== filterType) return false;
        if (filterMethod !== "all" && r.payment_method !== filterMethod) return false;
        if (q) {
          return (
            (r.email ?? "").toLowerCase().includes(q) ||
            (r.name ?? "").toLowerCase().includes(q) ||
            (r.transaction_id ?? "").toLowerCase().includes(q) ||
            (r.external_transaction_id ?? "").toLowerCase().includes(q) ||
            (r.note ?? "").toLowerCase().includes(q) ||
            (r.counterpartyEmail ?? "").toLowerCase().includes(q)
          );
        }
        return true;
      })
      .sort((a, b) =>
        sortNewest
          ? tsToMs(b.createdAt) - tsToMs(a.createdAt)
          : tsToMs(a.createdAt) - tsToMs(b.createdAt)
      );
  }, [records, filterStatus, filterType, filterMethod, searchQuery, sortNewest]);

  /* ── KPIs ────────────────────────────────────────────────────────────── */
  const pendingCount = useMemo(() =>
    records.filter((r) => r.transaction_status === "pending approval").length, [records]);
  const completedTxs = useMemo(() =>
    records.filter((r) => r.transaction_status === "completed"), [records]);

  const totalDeposited = useMemo(() =>
    completedTxs.filter((r) => r.transaction_type === "deposit")
      .reduce((s, r) => s + resolveDisplayAmount(r), 0), [completedTxs]);
  const totalWithdrawn = useMemo(() =>
    completedTxs.filter((r) => r.transaction_type === "withdrawal")
      .reduce((s, r) => s + resolveDisplayAmount(r), 0), [completedTxs]);
  const totalPayg = useMemo(() =>
    completedTxs.filter((r) => r.transaction_type === "credit_purchase")
      .reduce((s, r) => s + resolveDisplayAmount(r), 0), [completedTxs]);
  const totalSubscriptions = useMemo(() =>
    completedTxs.filter((r) => r.transaction_type === "subscription_purchase")
      .reduce((s, r) => s + resolveDisplayAmount(r), 0), [completedTxs]);

  const uniqueUsers = useMemo(() =>
    new Set(records.map((r) => r.email)).size, [records]);
  const approvalRate = records.length > 0
    ? Math.round((completedTxs.length / records.length) * 100) : 0;

  const hasFilters = filterStatus !== "all" || filterType !== "all"
    || filterMethod !== "all" || !!searchQuery;
  const clearFilters = () => {
    setFilterStatus("all");
    setFilterType("all");
    setFilterMethod("all");
    setSearchQuery("");
  };

  /* ── Loading splash ──────────────────────────────────────────────────── */
  if (initializing && records.length === 0) {
    return (
      <View style={ss.splashContainer}>
        <View style={ss.splashCard}>
          <ActivityIndicator size="large" color={T.accent} />
          <Text style={ss.splashText}>Loading transactions</Text>
          <Text style={ss.splashSub}>Connecting…</Text>
        </View>
      </View>
    );
  }

  /* ═══════════════════════════════════════════════════════════════════════
     Render
  ═══════════════════════════════════════════════════════════════════════ */
  return (
    <ReusableScreen>
      <View style={ss.root}>

        {/* ══ Header ══ */}
        <View style={ss.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={ss.backBtn}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="arrow-back" size={18} color={T.ink} />
          </TouchableOpacity>
          <View style={{ flex: 1, marginLeft: T.sp3 }}>
            <Text style={ss.headerTitle}>Wallet Transactions</Text>
            <Text style={ss.headerSub}>
              {records.length} loaded · {allLoaded ? "all fetched" : "more available"} · admin
            </Text>
          </View>
          <View style={ss.headerActions}>
            <TouchableOpacity
              onPress={() => setShowSummary((v) => !v)}
              style={[ss.iconBtn, showSummary && ss.iconBtnActive]}
              activeOpacity={0.7}
            >
              <Ionicons name="stats-chart-outline" size={17} color={showSummary ? T.accent : T.inkMid} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { setSelectMode((v) => !v); setSelectedIds(new Set()); }}
              style={[ss.iconBtn, selectMode && ss.iconBtnActive]}
              activeOpacity={0.7}
            >
              <Ionicons name="checkmark-done-outline" size={17} color={selectMode ? T.accent : T.inkMid} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleRefresh}
              style={ss.iconBtn}
              disabled={refreshing}
              activeOpacity={0.7}
            >
              {refreshing
                ? <ActivityIndicator size="small" color={T.accent} />
                : <Ionicons name="refresh-outline" size={17} color={T.inkMid} />
              }
            </TouchableOpacity>
          </View>
        </View>

        {/* ══ Error banner ══ */}
        {loadError && (
          <View style={ss.errorBanner}>
            <Ionicons name="warning-outline" size={14} color={T.rose} />
            <Text style={ss.errorBannerText}>{loadError}</Text>
            <TouchableOpacity onPress={handleRefresh} activeOpacity={0.7}>
              <Text style={ss.errorBannerRetry}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ══ KPI strip ══ */}
        <View style={ss.kpiStrip}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={ss.kpiScroll}>
            <KpiCard label="Deposited" value={formatGHS(totalDeposited)} icon="arrow-down-circle-outline" color={T.emerald} />
            <KpiCard label="Withdrawn" value={formatGHS(totalWithdrawn)} icon="arrow-up-circle-outline" color={T.accent} />
            <KpiCard label="Pay As You Go" value={formatGHS(totalPayg)} icon="flash-outline" color={T.paygColor} />
            <KpiCard label="Subscriptions" value={formatGHS(totalSubscriptions)} icon="ribbon-outline" color={T.subscriptionColor} />
            <KpiCard label="Pending" value={String(pendingCount)} icon="time-outline" color={T.amber} urgent={pendingCount > 0} />
            <KpiCard label="Completed" value={String(completedTxs.length)} icon="checkmark-circle-outline" color={T.emerald} />
            <KpiCard label="Approval %" value={`${approvalRate}%`} icon="trending-up-outline" color={T.blue} />
            <KpiCard label="Users" value={String(uniqueUsers)} icon="people-outline" color={T.inkMid} />
            <KpiCard label="Loaded" value={String(records.length)} icon="list-outline" color={T.inkMid} />
          </ScrollView>
        </View>

        {/* ══ Summary panel ══ */}
        {showSummary && (
          <View style={ss.summaryPanel}>
            <Text style={ss.summaryTitle}>Overview (loaded records)</Text>
            <View style={ss.summaryGrid}>
              {[
                { label: "Total Deposited", value: formatGHS(totalDeposited), color: T.emerald },
                { label: "Total Withdrawn", value: formatGHS(totalWithdrawn), color: T.accent },
                { label: "Pay As You Go", value: formatGHS(totalPayg), color: T.paygColor },
                { label: "Subscriptions", value: formatGHS(totalSubscriptions), color: T.subscriptionColor },
                { label: "Pending Review", value: String(pendingCount), color: T.amber },
                { label: "Approval Rate", value: `${approvalRate}%`, color: T.blue },
              ].map((item) => (
                <View key={item.label} style={ss.summaryCell}>
                  <Text style={[ss.summaryCellValue, { color: item.color }]}>{item.value}</Text>
                  <Text style={ss.summaryCellLabel}>{item.label}</Text>
                </View>
              ))}
            </View>
            {!allLoaded && (
              <Text style={ss.summaryNote}>
                ⚠ KPIs reflect {records.length} loaded records. Load more for complete figures.
              </Text>
            )}
          </View>
        )}

        {/* ══ Pending alert ══ */}
        {pendingCount > 0 && (
          <TouchableOpacity
            style={ss.alertBanner}
            onPress={() => setFilterStatus("pending approval")}
            activeOpacity={0.85}
          >
            <View style={ss.alertStripe} />
            <View style={[ss.alertIconWrap, { backgroundColor: T.amberSoft }]}>
              <Ionicons name="alert-circle-outline" size={16} color={T.amber} />
            </View>
            <Text style={ss.alertText}>
              <Text style={ss.alertCount}>{pendingCount}</Text>
              {" transaction"}{pendingCount !== 1 ? "s" : ""} awaiting review
            </Text>
            <View style={ss.alertCta}>
              <Text style={ss.alertCtaText}>Review</Text>
              <Ionicons name="chevron-forward" size={12} color={T.amber} />
            </View>
          </TouchableOpacity>
        )}

        {/* ══ Batch toolbar ══ */}
        {selectMode && (
          <View style={ss.batchBar}>
            <TouchableOpacity
              style={ss.batchSelectAll}
              onPress={() =>
                setSelectedIds(
                  selectedIds.size === filtered.length
                    ? new Set()
                    : new Set(filtered.map((r) => r.id))
                )
              }
              activeOpacity={0.7}
            >
              <View style={[ss.checkbox, selectedIds.size === filtered.length && ss.checkboxChecked]}>
                {selectedIds.size === filtered.length && (
                  <Ionicons name="checkmark" size={11} color="#fff" />
                )}
              </View>
              <Text style={ss.batchSelectLabel}>
                {selectedIds.size === filtered.length ? "Deselect all" : "All"}
              </Text>
            </TouchableOpacity>
            <Text style={ss.batchCount}>{selectedIds.size} selected</Text>
            <View style={ss.batchActions}>
              {(["completed", "failed", "cancelled"] as TxStatus[]).map((sv) => {
                const cfg = STATUS_CFG[sv];
                const active = batchStatus === sv;
                return (
                  <TouchableOpacity
                    key={sv}
                    style={[
                      ss.batchPill,
                      active && { backgroundColor: cfg.soft, borderColor: cfg.color + "55" },
                    ]}
                    onPress={() => setBatchStatus(sv)}
                    activeOpacity={0.7}
                  >
                    <Text style={[ss.batchPillText, active && { color: cfg.text, fontWeight: "600" }]}>
                      {cfg.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
              <TouchableOpacity
                style={[ss.batchApplyBtn, selectedIds.size === 0 && { opacity: 0.4 }]}
                onPress={handleBatchUpdate}
                disabled={selectedIds.size === 0 || batchUpdating}
                activeOpacity={0.8}
              >
                {batchUpdating
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={ss.batchApplyText}>Apply</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ══ Search ══ */}
        <View style={ss.searchWrap}>
          <View style={ss.searchBox}>
            <Ionicons name="search-outline" size={16} color={T.inkMuted} style={{ marginRight: 8 }} />
            <TextInput
              style={[ss.searchInput, Platform.OS === "web" && ({ outlineStyle: "none" } as any)]}
              placeholder="Email, name, transaction ID, note…"
              placeholderTextColor={T.inkMuted}
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity
                onPress={() => setSearchQuery("")}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close-circle" size={16} color={T.inkMuted} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* ══ Filters ══ */}
        <View style={ss.filtersContainer}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={ss.filterRow}>
            <FilterPill label="All status" active={filterStatus === "all"} color={T.accent} soft={T.accentSoft} text={T.accentText} onPress={() => setFilterStatus("all")} />
            {ALL_STATUSES.map((sv) => {
              const c = STATUS_CFG[sv];
              return (
                <FilterPill key={sv} label={c.label} active={filterStatus === sv}
                  color={c.color} soft={c.soft} text={c.text}
                  onPress={() => setFilterStatus(sv)} />
              );
            })}
          </ScrollView>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={ss.filterRow}>
            <FilterPill label="All types" active={filterType === "all"} color={T.accent} soft={T.accentSoft} text={T.accentText} onPress={() => setFilterType("all")} />
            {(Object.keys(TYPE_CFG) as TxType[])
              .filter((k) => uniqueTypes.includes(k))
              .map((tv) => (
                <FilterPill key={tv} label={TYPE_CFG[tv].label} active={filterType === tv}
                  color={T.accent} soft={T.accentSoft} text={T.accentText}
                  onPress={() => setFilterType(tv)} />
              ))}
          </ScrollView>

          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}
              contentContainerStyle={[ss.filterRow, { paddingRight: 0 }]}>
              {uniqueMethods.map((mv) => (
                <FilterPill key={mv}
                  label={mv === "all" ? "All methods" : (METHOD_LABEL[mv] ?? mv)}
                  active={filterMethod === mv}
                  color={T.accent} soft={T.accentSoft} text={T.accentText}
                  onPress={() => setFilterMethod(mv)} />
              ))}
            </ScrollView>
            <TouchableOpacity style={ss.sortBtn} onPress={() => setSortNewest((v) => !v)} activeOpacity={0.7}>
              <Ionicons name={sortNewest ? "arrow-down-outline" : "arrow-up-outline"} size={12} color={T.accent} />
              <Text style={ss.sortBtnText}>{sortNewest ? "Newest" : "Oldest"}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ══ Results bar ══ */}
        <View style={ss.resultsBar}>
          <Text style={ss.resultsText}>
            <Text style={ss.resultsCount}>{filtered.length}</Text>
            {" / "}
            <Text style={ss.resultsCount}>{records.length}</Text>
            {" loaded"}
            {!allLoaded && <Text style={{ color: T.inkMuted }}> · more available</Text>}
          </Text>
          {hasFilters && (
            <TouchableOpacity onPress={clearFilters} activeOpacity={0.7}>
              <Text style={ss.clearFilters}>Clear filters</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ══ Transaction list ══ */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={ss.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              colors={[T.accent]}
              tintColor={T.accent}
            />
          }
        >
          {filtered.length === 0 ? (
            <View style={ss.emptyState}>
              <View style={ss.emptyIcon}>
                <MaterialIcons name="receipt-long" size={30} color={T.inkMuted} />
              </View>
              <Text style={ss.emptyTitle}>
                {records.length > 0 ? "No matching records" : "No transactions yet"}
              </Text>
              <Text style={ss.emptyBody}>
                {records.length > 0
                  ? "Adjust your filters or search terms."
                  : "Transactions will appear here once users submit them."}
              </Text>
              {hasFilters && (
                <TouchableOpacity style={ss.emptyClearBtn} onPress={clearFilters} activeOpacity={0.8}>
                  <Text style={ss.emptyClearText}>Clear filters</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            filtered.map((tx) => {
              const expanded = expandedId === tx.id;
              const selected = selectedIds.has(tx.id);
              const scfg = STATUS_CFG[tx.transaction_status] ?? STATUS_CFG["pending approval"];
              const subType = resolveSubscriptionSubType(tx);
              const isSubscription = tx.transaction_type === "subscription_purchase";
              const isPayg = tx.transaction_type === "credit_purchase";

              const label = txLabel(tx);
              const icon = txIcon(tx);
              const amountColor = txAmountColor(tx);
              const prefix = txAmountPrefix(tx);
              const displayAmt = resolveDisplayAmount(tx);

              const statusBarColor = isSubscription
                ? subscriptionColor(subType)
                : isPayg ? T.paygColor : scfg.color;

              return (
                <View
                  key={tx.id}
                  style={[ss.txCard, selected && ss.txCardSelected, expanded && ss.txCardExpanded]}
                >
                  <TouchableHighlight
                    onPress={() => {
                      if (selectMode) {
                        setSelectedIds((prev) => {
                          const next = new Set(prev);
                          next.has(tx.id) ? next.delete(tx.id) : next.add(tx.id);
                          return next;
                        });
                      } else {
                        setExpandedId(expanded ? null : tx.id);
                      }
                    }}
                    underlayColor={T.bg}
                    activeOpacity={0.9}
                    style={ss.txMainRow}
                  >
                    <View style={ss.txMainInner}>
                      {selectMode ? (
                        <View style={[ss.checkbox, selected && ss.checkboxChecked, { marginRight: T.sp3, marginLeft: 2 }]}>
                          {selected && <Ionicons name="checkmark" size={11} color="#fff" />}
                        </View>
                      ) : (
                        <View style={[ss.txStripe, { backgroundColor: statusBarColor }]} />
                      )}
                      <View style={ss.txContent}>
                        <View style={ss.txTopRow}>
                          <Text style={ss.txEmail} numberOfLines={1}>{tx.email ?? "—"}</Text>
                          <View style={{ flexDirection: "row", alignItems: "center" }}>
                            <StatusBadge status={tx.transaction_status} />
                            {!selectMode && (
                              <Ionicons
                                name={expanded ? "chevron-up" : "chevron-down"}
                                size={14} color={T.inkMuted} style={{ marginLeft: 4 }}
                              />
                            )}
                          </View>
                        </View>
                        <View style={ss.txMidRow}>
                          <Text style={[ss.txAmount, { color: amountColor }]}>
                            {prefix}{formatGHS(displayAmt)}
                          </Text>
                          <Text style={ss.txDot}>·</Text>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                            <Ionicons name={icon as any} size={13} color={T.inkMid} />
                            <Text style={[ss.txType, (isSubscription || isPayg) && { color: amountColor, fontWeight: "700" }]}>
                              {label}
                            </Text>
                          </View>
                          {isSubscription && tx.subscription_snapshot?.stacked && (
                            <><Text style={ss.txDot}>·</Text><Text style={[ss.txMeta, { color: amountColor }]}>Extended</Text></>
                          )}
                          {isPayg && tx.credit_snapshot?.credits_purchased != null && (
                            <><Text style={ss.txDot}>·</Text><Text style={[ss.txMeta, { color: T.paygColor }]}>{tx.credit_snapshot.credits_purchased} credits</Text></>
                          )}
                          {tx.payment_method && (
                            <Text style={ss.txMeta}>· {METHOD_LABEL[tx.payment_method] ?? tx.payment_method}</Text>
                          )}
                        </View>
                        <Text style={ss.txDate}>{fmtShort(tx.createdAt)}</Text>
                      </View>
                    </View>
                  </TouchableHighlight>

                  {expanded && !selectMode && (
                    <View style={ss.detailPanel}>
                      <View style={ss.detailSection}>
                        <Text style={ss.detailSectionTitle}>Transaction Details</Text>
                        <DetailRow label="User email" value={tx.email ?? "—"} />
                        <DetailRow label="Transaction amount" value={tx.transaction_amount != null ? formatGHS(tx.transaction_amount) : "—"} valueColor={amountColor} />
                        <DetailRow label="Previous balance" value={tx.previous_balance != null ? formatGHS(tx.previous_balance) : "—"} />
                        <DetailRow label="Current balance" value={tx.current_balance != null ? formatGHS(tx.current_balance) : "—"} valueColor={T.ink} />
                        <DetailRow label="Type" value={label} valueColor={amountColor} />
                        <DetailRow label="Status" value={scfg.label} valueColor={scfg.color} />
                        <DetailRow label="Currency" value={tx.currency ?? "GHS"} />
                        {tx.payment_method && <DetailRow label="Payment method" value={METHOD_LABEL[tx.payment_method] ?? tx.payment_method} />}
                        <DetailRow label="Submitted" value={fmtDate(tx.createdAt)} />
                        {tx.updatedAt && <DetailRow label="Last updated" value={fmtDate(tx.updatedAt)} />}
                        {tx.reviewedAt && <DetailRow label="Reviewed at" value={fmtDate(tx.reviewedAt)} />}
                        {tx.reviewedBy && <DetailRow label="Reviewed by" value={tx.reviewedBy} />}
                        {tx.counterpartyEmail && <DetailRow label="Counterparty" value={`${tx.counterpartyName ?? ""} (${tx.counterpartyEmail})`} />}
                        {tx.note && <DetailRow label="Note" value={tx.note} />}

                        {isPayg && tx.credit_snapshot && (
                          <>
                            <DetailRow label="Credits purchased" value={String(tx.credit_snapshot.credits_purchased)} valueColor={T.paygColor} />
                            <DetailRow label="Credits total after" value={String(tx.credit_snapshot.credits_total_after)} />
                            <DetailRow label="Price per credit" value={`GHS ${tx.credit_snapshot.price_per_credit.toFixed(2)}`} />
                          </>
                        )}

                        {isSubscription && tx.subscription_snapshot && (
                          <>
                            <DetailRow label="Plan" value={subscriptionLabel(subType)} valueColor={subscriptionColor(subType)} />
                            <DetailRow label="Expires at" value={fmtDate(tx.subscription_snapshot.expires_at)} />
                            <DetailRow label="Stacked purchase" value={tx.subscription_snapshot.stacked ? "Yes" : "No"} />
                            <DetailRow label="Total purchases" value={String(tx.subscription_snapshot.total_purchases)} />
                          </>
                        )}

                        <CopyRow label="Transaction ID" value={tx.transaction_id ?? tx.id} />
                        {tx.external_transaction_id && <CopyRow label="External Tx ID" value={tx.external_transaction_id} />}
                        <CopyRow label="Doc ID" value={tx.id} />

                      </View>

                      {!!tx.adminNote && (
                        <View style={ss.noteBox}>
                          <View style={ss.noteDot} />
                          <Text style={ss.noteText}>{tx.adminNote}</Text>
                        </View>
                      )}

                      <View style={ss.actionRow}>
                        <TouchableOpacity style={ss.actionEdit} onPress={() => openModal(tx)} activeOpacity={0.8}>
                          <Ionicons name="create-outline" size={14} color={T.accentText} style={{ marginRight: 5 }} />
                          <Text style={ss.actionEditText}>Update status</Text>
                        </TouchableOpacity>
                        {tx.transaction_status === "pending approval" && (
                          <>
                            <TouchableOpacity style={ss.actionApprove} onPress={() => openModal(tx, "completed")} activeOpacity={0.8}>
                              <Ionicons name="checkmark-outline" size={14} color={T.emeraldText} style={{ marginRight: 5 }} />
                              <Text style={ss.actionApproveText}>Approve</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={ss.actionReject} onPress={() => openModal(tx, "cancelled")} activeOpacity={0.8}>
                              <Ionicons name="close-outline" size={14} color={T.roseText} style={{ marginRight: 5 }} />
                              <Text style={ss.actionRejectText}>Cancel</Text>
                            </TouchableOpacity>
                          </>
                        )}
                      </View>
                    </View>
                  )}
                </View>
              );
            })
          )}

          {records.length > 0 && (
            <LoadMoreFooter
              loading={loadingMore}
              allLoaded={allLoaded}
              loadedCount={records.length}
              onPress={handleLoadMore}
            />
          )}

          <View style={{ height: 50 }} />
        </ScrollView>

        {/* ══ Status update modal ══ */}
        <StatusUpdateModal
          visible={modalVisible}
          tx={selectedTx}
          currentStatus={newStatus}
          adminNote={adminNote}
          updating={updating}
          reviewerName={userName || (userEmail ?? ADMIN_EMAIL)}
          onClose={() => setModalVisible(false)}
          onStatusChange={setNewStatus}
          onNoteChange={setAdminNote}
          onConfirm={handleStatusUpdate}
        />

        {/* ══ ConfirmDialog (replaces all Alert.alert) ══ */}
        <ConfirmDialog
          visible={dialog.visible}
          title={dialog.title}
          message={dialog.message}
          note={dialog.note}
          confirmLabel={dialog.confirmLabel}
          cancelLabel={dialog.cancelLabel}
          confirmVariant={dialog.confirmVariant}
          onConfirm={dialog.onConfirm}
          onCancel={dialog.onCancel}
        />

        {/* ══ ToastBanner (replaces old Toast) ══ */}
        {toast && (
          <ToastBanner
            message={toast.message}
            type={toast.type}
            onDismiss={dismissToast}
          />
        )}

      </View>
    </ReusableScreen>
  );
}

/* ─── Styles ─────────────────────────────────────────────────────────────── */
const ss = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg },

  splashContainer: { flex: 1, backgroundColor: T.bg, justifyContent: "center", alignItems: "center" },
  splashCard: {
    backgroundColor: T.surface, borderRadius: T.radiusXl,
    paddingHorizontal: 40, paddingVertical: 36, alignItems: "center",
    borderWidth: 1, borderColor: T.border,
  },
  splashText: { marginTop: 16, fontSize: 15, fontWeight: "600", color: T.ink },
  splashSub: { marginTop: 4, fontSize: 13, color: T.inkMuted },

  errorBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: T.sp4, paddingVertical: 9,
    backgroundColor: "#FFF1F2", borderBottomWidth: 1, borderBottomColor: "#FDA4AF",
  },
  errorBannerText: { flex: 1, fontSize: 12.5, color: T.rose, fontWeight: "500" },
  errorBannerRetry: { fontSize: 12.5, fontWeight: "700", color: T.accent },

  header: {
    flexDirection: "row", alignItems: "center", backgroundColor: T.surface,
    paddingHorizontal: T.sp4, paddingVertical: T.sp3,
    borderBottomWidth: 1, borderBottomColor: T.border,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: T.radiusMd,
    backgroundColor: T.bg, borderWidth: 1, borderColor: T.border,
    justifyContent: "center", alignItems: "center",
  },
  headerTitle: { fontSize: 17, fontWeight: "700", color: T.ink, letterSpacing: -0.3 },
  headerSub: { fontSize: 11, color: T.inkMuted, marginTop: 1 },
  headerActions: { flexDirection: "row", gap: T.sp2, alignItems: "center" },
  iconBtn: {
    width: 36, height: 36, borderRadius: T.radiusMd,
    backgroundColor: T.bg, borderWidth: 1, borderColor: T.border,
    justifyContent: "center", alignItems: "center",
  },
  iconBtnActive: { backgroundColor: T.accentSoft, borderColor: T.accentMid },

  kpiStrip: { backgroundColor: T.surface, borderBottomWidth: 1, borderBottomColor: T.border },
  kpiScroll: { paddingHorizontal: T.sp4, paddingVertical: T.sp3, gap: T.sp2, flexDirection: "row" },
  kpiCard: {
    alignItems: "center", backgroundColor: T.surfaceRaised, borderRadius: T.radiusMd,
    paddingVertical: 10, paddingHorizontal: 14, minWidth: 84,
    borderWidth: 1, borderColor: T.border, gap: 3, position: "relative",
  },
  kpiUrgentDot: { position: "absolute", top: 6, right: 6, width: 6, height: 6, borderRadius: 3 },
  kpiIconWrap: { width: 26, height: 26, borderRadius: 7, justifyContent: "center", alignItems: "center", marginBottom: 2 },
  kpiValue: { fontSize: 14, fontWeight: "700", letterSpacing: -0.4 },
  kpiLabel: { fontSize: 10, fontWeight: "500", color: T.inkMuted, textAlign: "center" },

  summaryPanel: {
    backgroundColor: T.surface, paddingHorizontal: T.sp4, paddingVertical: T.sp4,
    borderBottomWidth: 1, borderBottomColor: T.border,
  },
  summaryTitle: {
    fontSize: 11, fontWeight: "700", color: T.inkMuted,
    textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 12,
  },
  summaryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  summaryCell: {
    minWidth: "46%", flex: 1, backgroundColor: T.bg, borderRadius: T.radiusMd,
    borderWidth: 1, borderColor: T.border, paddingVertical: 10, paddingHorizontal: 6,
    alignItems: "center", gap: 3,
  },
  summaryCellValue: { fontSize: 13, fontWeight: "700", letterSpacing: -0.3, textAlign: "center" },
  summaryCellLabel: { fontSize: 10, color: T.inkMuted, textAlign: "center" },
  summaryNote: {
    marginTop: 8, fontSize: 11.5, color: T.amberText,
    backgroundColor: T.amberSoft, borderRadius: T.radiusSm,
    paddingHorizontal: 10, paddingVertical: 6,
  },

  alertBanner: {
    flexDirection: "row", alignItems: "center", backgroundColor: T.amberSoft,
    borderBottomWidth: 1, borderBottomColor: T.amberMid + "55",
    paddingVertical: 10, paddingRight: T.sp4, overflow: "hidden", position: "relative",
  },
  alertStripe: { width: 3, position: "absolute", left: 0, top: 0, bottom: 0, backgroundColor: T.amber },
  alertIconWrap: {
    marginLeft: T.sp4, marginRight: T.sp3, width: 28, height: 28,
    borderRadius: T.radiusSm, justifyContent: "center", alignItems: "center",
  },
  alertText: { flex: 1, fontSize: 13, color: T.amberText },
  alertCount: { fontWeight: "700", fontSize: 13, color: T.amberText },
  alertCta: {
    flexDirection: "row", alignItems: "center", backgroundColor: "#FDE68A55",
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: T.radiusSm, borderWidth: 0.5, borderColor: T.amberMid, gap: 2,
  },
  alertCtaText: { fontSize: 12.5, fontWeight: "700", color: T.amber },

  batchBar: {
    flexDirection: "row", alignItems: "center", flexWrap: "wrap",
    backgroundColor: T.accentSoft, borderBottomWidth: 1, borderBottomColor: T.accentMid + "66",
    paddingHorizontal: T.sp4, paddingVertical: T.sp2, gap: T.sp2,
  },
  batchSelectAll: { flexDirection: "row", alignItems: "center", gap: 6 },
  batchSelectLabel: { fontSize: 12.5, color: T.accent, fontWeight: "600" },
  batchCount: { fontSize: 12, color: T.inkMid, flex: 1 },
  batchActions: { flexDirection: "row", gap: 6, alignItems: "center" },
  batchPill: {
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: T.radiusFull, borderWidth: 1, borderColor: T.border, backgroundColor: T.surface,
  },
  batchPillText: { fontSize: 12, color: T.inkMid },
  batchApplyBtn: {
    backgroundColor: T.accent, borderRadius: T.radiusSm,
    paddingHorizontal: 16, paddingVertical: 6, minWidth: 56, alignItems: "center",
  },
  batchApplyText: { fontSize: 12.5, fontWeight: "700", color: "#fff" },

  checkbox: {
    width: 18, height: 18, borderRadius: 4, borderWidth: 1.5, borderColor: T.borderStrong,
    justifyContent: "center", alignItems: "center", backgroundColor: T.surface,
  },
  checkboxChecked: { backgroundColor: T.accent, borderColor: T.accent },

  searchWrap: {
    backgroundColor: T.surface, paddingHorizontal: T.sp4, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: T.border,
  },
  searchBox: {
    flexDirection: "row", alignItems: "center", backgroundColor: T.bg,
    borderRadius: T.radiusMd, paddingHorizontal: 12, paddingVertical: 9,
    borderWidth: 1, borderColor: T.border,
  },
  searchInput: { flex: 1, fontSize: 14, color: T.ink },

  filtersContainer: {
    backgroundColor: T.surface, borderBottomWidth: 1, borderBottomColor: T.border, paddingBottom: T.sp2,
  },
  filterRow: { paddingHorizontal: T.sp4, paddingTop: T.sp2, flexDirection: "row", gap: 6 },
  pill: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: T.radiusFull, borderWidth: 1, borderColor: T.border,
    backgroundColor: T.bg, minHeight: 32,
  },
  pillDot: { width: 5, height: 5, borderRadius: 3, marginRight: 5 },
  pillText: { fontSize: 12.5, fontWeight: "500", color: T.inkMid },
  sortBtn: {
    flexDirection: "row", alignItems: "center", gap: 3,
    marginRight: T.sp4, marginLeft: T.sp2,
    backgroundColor: T.accentSoft, paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: T.radiusFull, borderWidth: 1, borderColor: T.accentMid + "66",
  },
  sortBtnText: { fontSize: 12, fontWeight: "600", color: T.accent },

  resultsBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: T.sp4, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: T.border, backgroundColor: T.bg,
  },
  resultsText: { fontSize: 12, color: T.inkMuted },
  resultsCount: { fontWeight: "700", color: T.ink },
  clearFilters: { fontSize: 12, color: T.accent, fontWeight: "600" },

  listContent: { paddingHorizontal: T.sp4, paddingTop: T.sp3, paddingBottom: 50, gap: 8 },

  txCard: {
    backgroundColor: T.surface, borderRadius: T.radiusLg,
    borderWidth: 1, borderColor: T.border, overflow: "hidden",
  },
  txCardSelected: { borderColor: T.accentMid, backgroundColor: T.accentSoft },
  txCardExpanded: { borderColor: T.borderStrong },
  txMainRow: { borderRadius: T.radiusLg },
  txMainInner: { flexDirection: "row", alignItems: "stretch" },
  txStripe: { width: 3, alignSelf: "stretch", minHeight: 56 },
  txContent: { flex: 1, paddingVertical: T.sp3, paddingRight: T.sp3, paddingLeft: T.sp3 },
  txTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 5 },
  txEmail: { fontSize: 13.5, fontWeight: "600", color: T.ink, flex: 1, marginRight: 8 },
  txMidRow: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 4, flexWrap: "wrap" },
  txAmount: { fontSize: 15, fontWeight: "700", letterSpacing: -0.3 },
  txDot: { fontSize: 11, color: T.inkMuted },
  txType: { fontSize: 12.5, color: T.inkMid },
  txMeta: { fontSize: 12, color: T.inkMuted },
  txDate: { fontSize: 11.5, color: T.inkMuted },

  badge: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingVertical: 3, borderRadius: T.radiusFull },
  badgeDot: { width: 5, height: 5, borderRadius: 3, marginRight: 5 },
  badgeText: { fontSize: 11.5, fontWeight: "600" },

  detailPanel: {
    borderTopWidth: 1, borderTopColor: T.border,
    paddingHorizontal: T.sp4, paddingTop: T.sp3, paddingBottom: T.sp4,
  },
  detailSection: { marginBottom: T.sp3 },
  detailSectionTitle: {
    fontSize: 11, fontWeight: "700", color: T.inkMuted,
    textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 8,
  },
  detailRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: T.bg,
  },
  detailLabel: { fontSize: 13, color: T.inkMid, flex: 1 },
  detailValue: { fontSize: 13, fontWeight: "500", color: T.ink, textAlign: "right", maxWidth: "60%" },
  detailMono: {
    fontFamily: Platform.OS === "ios" ? "Courier New" : "monospace",
    fontSize: 11.5, color: T.ink, maxWidth: 180,
  },
  copyTarget: { flexDirection: "row", alignItems: "center", maxWidth: "62%" },

  approvalWarning: {
    flexDirection: "row", alignItems: "flex-start", gap: 6,
    backgroundColor: T.blueSoft, borderRadius: T.radiusSm, padding: 10,
    marginBottom: T.sp3, borderWidth: 1, borderColor: T.blueMid,
  },
  approvalWarningText: { fontSize: 12.5, color: T.blueText, flex: 1, lineHeight: 18 },

  noteBox: {
    flexDirection: "row", alignItems: "flex-start",
    backgroundColor: T.amberSoft, borderRadius: T.radiusSm, padding: 10,
    marginBottom: T.sp3, borderLeftWidth: 3, borderLeftColor: T.amber,
  },
  noteDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: T.amber, marginTop: 5, marginRight: 8, flexShrink: 0 },
  noteText: { fontSize: 13, color: T.amberText, flex: 1, lineHeight: 19 },

  actionRow: { flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: T.sp1 },
  actionEdit: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 8, paddingHorizontal: 12,
    borderRadius: T.radiusSm, borderWidth: 1, borderColor: T.accentMid,
    backgroundColor: T.accentSoft, minHeight: 36,
  },
  actionEditText: { fontSize: 13, fontWeight: "600", color: T.accentText },
  actionApprove: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 8, paddingHorizontal: 12,
    borderRadius: T.radiusSm, borderWidth: 1, borderColor: T.emeraldMid,
    backgroundColor: T.emeraldSoft, minHeight: 36,
  },
  actionApproveText: { fontSize: 13, fontWeight: "600", color: T.emeraldText },
  actionReject: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 8, paddingHorizontal: 12,
    borderRadius: T.radiusSm, borderWidth: 1, borderColor: T.roseMid,
    backgroundColor: T.roseSoft, minHeight: 36,
  },
  actionRejectText: { fontSize: 13, fontWeight: "600", color: T.roseText },

  loadMoreContainer: { paddingHorizontal: T.sp4, paddingVertical: T.sp3, alignItems: "center" },
  loadMoreDivider: { height: 1, backgroundColor: T.border, width: "100%", marginBottom: T.sp3 },
  loadMoreLoadingRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12 },
  loadMoreLoadingText: { fontSize: 13.5, color: T.inkMid, fontWeight: "500" },
  loadMoreButton: {
    flexDirection: "row", alignItems: "center", gap: T.sp2,
    paddingHorizontal: 20, paddingVertical: 12,
    backgroundColor: T.accentSoft, borderRadius: T.radiusMd,
    borderWidth: 1.5, borderColor: T.accentMid,
  },
  loadMoreButtonText: { fontSize: 14, fontWeight: "600", color: T.accent },
  loadMoreBadge: { marginLeft: 4, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: T.accentMid, borderRadius: T.radiusFull },
  loadMoreBadgeText: { fontSize: 11, fontWeight: "700", color: T.accentText },

  allLoadedFooter: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: T.sp4, paddingVertical: T.sp5, gap: T.sp3,
  },
  allLoadedLine: { flex: 1, height: 1, backgroundColor: T.border },
  allLoadedText: { fontSize: 12, color: T.inkMuted, fontWeight: "500" },

  emptyState: { alignItems: "center", paddingTop: 60, gap: 8 },
  emptyIcon: {
    width: 64, height: 64, borderRadius: T.radiusLg,
    backgroundColor: T.surface, borderWidth: 1, borderColor: T.border,
    justifyContent: "center", alignItems: "center", marginBottom: 4,
  },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: T.ink },
  emptyBody: { fontSize: 13.5, color: T.inkMid, textAlign: "center", maxWidth: 260, lineHeight: 20 },
  emptyClearBtn: {
    marginTop: 12, backgroundColor: T.accent, borderRadius: T.radiusMd,
    paddingHorizontal: 22, paddingVertical: 10, minHeight: 44,
  },
  emptyClearText: { fontSize: 14, fontWeight: "700", color: "#fff" },

  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  modalSheet: {
    backgroundColor: T.surface,
    borderTopLeftRadius: T.radiusXl, borderTopRightRadius: T.radiusXl,
    paddingHorizontal: T.sp4, paddingBottom: 32, paddingTop: T.sp3,
  },
  modalHandle: {
    width: 36, height: 4, borderRadius: 2, backgroundColor: T.borderStrong,
    alignSelf: "center", marginBottom: T.sp4,
  },
  modalTitleRow: {
    flexDirection: "row", alignItems: "flex-start",
    justifyContent: "space-between", marginBottom: T.sp4,
  },
  modalTitle: { fontSize: 18, fontWeight: "700", color: T.ink },
  modalSub: { fontSize: 13, color: T.inkMuted, marginTop: 2, maxWidth: 220 },
  modalCloseBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: T.bg, justifyContent: "center", alignItems: "center" },
  modalSummary: {
    backgroundColor: T.bg, borderRadius: T.radiusMd, padding: T.sp3,
    marginBottom: T.sp4, alignItems: "flex-start", gap: 6,
    borderWidth: 1, borderColor: T.border,
  },
  modalSummaryAmount: { fontSize: 22, fontWeight: "800", color: T.ink },
  modalSummaryType: { fontSize: 13, color: T.inkMid, marginBottom: 4 },

  statusGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  statusOption: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: T.radiusMd, borderWidth: 1.5, borderColor: T.border, backgroundColor: T.bg,
  },
  statusOptionText: { fontSize: 13, fontWeight: "500", color: T.inkMid },

  fieldLabel: { fontSize: 13, color: T.inkMid, fontWeight: "600", marginBottom: 6 },
  noteInput: {
    borderWidth: 1.5, borderColor: T.border, borderRadius: T.radiusMd,
    paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: T.ink,
    backgroundColor: T.bg, minHeight: 80, textAlignVertical: "top",
  },
  reviewerLabel: { fontSize: 12, color: T.inkMuted, marginTop: T.sp2, marginBottom: T.sp3 },
  confirmBtn: { borderRadius: T.radiusMd, paddingVertical: 14, alignItems: "center" },
  confirmBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
});
