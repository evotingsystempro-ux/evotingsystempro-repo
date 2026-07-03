import React, {
    useCallback,
    useContext,
    useEffect,
    useRef,
    useState,
} from "react";
import {
    ActivityIndicator,
    Animated,
    Platform,
    Pressable,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
    useWindowDimensions,
    Image,
    KeyboardAvoidingView,
} from "react-native";
import { Feather, Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import {
    addDoc,
    collection,
    doc,
    getDoc,
    getDocs,
    limit,
    orderBy,
    query,
    serverTimestamp,
    updateDoc,
    where,
    startAfter,
    QueryDocumentSnapshot,
} from "firebase/firestore";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { db } from "@/firebase";
import { GlobalContext } from "@/context";
import { UserStorageKeys } from "@/hooks/storageKeys";
import { getTimeAgo } from "@/hooks/getTimeAgo";
import ReusableScreen from "@/components/ReusableScreen";
import ChatBanner from "@/components/ChatBanner";
import PopupMenu from "@/components/PupupMenu";
import { MenuProvider } from "react-native-popup-menu";
import { useWithdrawCountries, type WithdrawCountry, type WithdrawMethodKey } from "@/hooks/useWithdrawCountries";

// ─── Constants ────────────────────────────────────────────────────────────────
const TRANSACTION_WALLET_DB = "TRANSACTION_WALLET_DB";
/** Single-document wallet store. Doc ID === userId. */
const WALLET_DB = "WALLET_DB";
const MEMBERS_DB = "members_list_db";
const MIN_WITHDRAWAL = 1;
const MIN_P2P = 1;
const TX_PAGE_SIZE = 10;
const STRIP_FETCH_LIMIT = 20;


const IS_WEB = Platform.OS === 'web';
const IS_IOS = Platform.OS === 'ios';

const PAYMENT_METHODS = [
    {
        key: "momo",
        label: "MoMo",
        dest: "0502309630 / 0543171076",
        icon: "phone-portrait-outline",
    },
    {
        key: "eth",
        label: "Ethereum",
        dest: "0x71C7656EC7ab88b098defB751B7401B5f6d8976F",
        icon: "logo-bitcoin",
    },
    {
        key: "binance",
        label: "Binance Pay",
        dest: "103217392",
        icon: "swap-horizontal-outline",
    },
    {
        key: "stanbic",
        label: "Stanbic Bank",
        dest: "9040007935433",
        icon: "business-outline",
    },
] as const;

// ─── Withdrawal country + method config ───────────────────────────────────────
const WITHDRAW_COUNTRIES = useWithdrawCountries();

interface WithdrawMethodConfig {
    key: WithdrawMethodKey;
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    accountLabel: string;
    accountPlaceholder: string;
    keyboardType: "default" | "phone-pad" | "decimal-pad";
    minGHS: number;
    maxGHS: number;
    feePercent: number;
    feeFlat: number;
    hasOperator: boolean;
}

const WITHDRAW_METHOD_CONFIGS: Record<WithdrawMethodKey, WithdrawMethodConfig> = {
    momo: {
        key: "momo", label: "Mobile Money", icon: "phone-portrait-outline",
        accountLabel: "Mobile Money Number", accountPlaceholder: "e.g. 0551234567",
        keyboardType: "phone-pad",
        minGHS: 1, maxGHS: 5000, feePercent: 0.01, feeFlat: 0,
        hasOperator: true,
    },
    bank: {
        key: "bank", label: "Bank Transfer", icon: "business-outline",
        accountLabel: "Account Number / IBAN", accountPlaceholder: "e.g. 9040007935433",
        keyboardType: "default",
        minGHS: 10, maxGHS: 50000, feePercent: 0.015, feeFlat: 2,
        hasOperator: true,
    },
    eth: {
        key: "eth", label: "Ethereum (ERC-20)", icon: "logo-bitcoin",
        accountLabel: "ETH Wallet Address", accountPlaceholder: "0x…",
        keyboardType: "default",
        minGHS: 50, maxGHS: 200000, feePercent: 0.02, feeFlat: 5,
        hasOperator: false,
    },
    binance: {
        key: "binance", label: "Binance Pay", icon: "swap-horizontal-outline",
        accountLabel: "Binance Pay ID", accountPlaceholder: "e.g. 103217392",
        keyboardType: "default",
        minGHS: 20, maxGHS: 100000, feePercent: 0.005, feeFlat: 0,
        hasOperator: false,
    },
    usdt_trc20: {
        key: "usdt_trc20", label: "USDT (TRC-20)", icon: "cash-outline",
        accountLabel: "TRON Wallet Address", accountPlaceholder: "T…",
        keyboardType: "default",
        minGHS: 20, maxGHS: 100000, feePercent: 0.005, feeFlat: 1,
        hasOperator: false,
    },
};

/**
 * calcWithdrawFee — fee = percentFee + feeFlat (feeFlat added exactly once).
 */
function calcWithdrawFee(amountGHS: number, method: WithdrawMethodKey): {
    fee: number; net: number;
} {
    const cfg = WITHDRAW_METHOD_CONFIGS[method];
    const percentFee = amountGHS * cfg.feePercent;
    const fee = parseFloat((percentFee + cfg.feeFlat).toFixed(2));
    const net = parseFloat((amountGHS - fee).toFixed(2));
    return { fee, net };
}

type PaymentMethodKey = (typeof PAYMENT_METHODS)[number]["key"];

const COINGECKO_IDS: Record<string, string> = {
    BTC: "bitcoin",
    ETH: "ethereum",
    BNB: "binancecoin",
    ADA: "cardano",
    ALGO: "algorand",
    XDC: "xdc-network",
};

const GENDER_OPTIONS = [
    "male",
    "female",
    "other",
    "prefer_not_to_say",
] as const;
type GenderOption = (typeof GENDER_OPTIONS)[number];

// ─── Types ────────────────────────────────────────────────────────────────────

type WalletTransactionType =
    | "deposit"
    | "withdrawal"
    | "P2P_money_transfer"
    | "credit_purchase"
    | "subscription_purchase";

interface WalletTx {
    id: string;
    email: string;
    transaction_id: string;
    external_transaction_id: string;
    transaction_type: WalletTransactionType;
    previous_balance: number | null;
    current_balance: number | null;
    transaction_amount: number | null;
    transaction_status: string;
    currency: string;
    payment_method: string;
    note?: string;
    createdAt: any;
    counterpartyEmail?: string;
    counterpartyName?: string;
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

interface PersonalForm {
    actualFullname: string;
    actualDayOfBirth: string;
    actualMonthOfBirth: string;
    actualYearOfBirth: string;
    actualGender: string;
    phone: string;
}

type CryptoItem = { name: string; symbol: string; value: number };

// ─── Transaction display helpers ───────────────────────────────────────────────

function txLabel(tx: WalletTx): string {
    switch (tx.transaction_type) {
        case "deposit": return "Deposit";
        case "withdrawal": return "Withdrawal";
        case "P2P_money_transfer": return "P2P Transfer";
        case "credit_purchase": return "Pay As You Go";
        case "subscription_purchase": {
            const plan = tx.subscription_snapshot?.plan ?? resolveSubPlanFromNote(tx.note);
            if (plan === "monthly") return "Monthly Plan";
            return "Subscription";
        }
        default: return "Transaction";
    }
}

function resolveSubPlanFromNote(note?: string): "monthly" | null {
    if (!note) return null;
    return note.toLowerCase().includes("month") ? "monthly" : null;
}

function txIcon(tx: WalletTx): keyof typeof Ionicons.glyphMap {
    switch (tx.transaction_type) {
        case "deposit": return "arrow-down-circle-outline";
        case "withdrawal": return "arrow-up-circle-outline";
        case "P2P_money_transfer": return "swap-horizontal-outline";
        case "credit_purchase": return "flash-outline";
        case "subscription_purchase": {
            const plan = tx.subscription_snapshot?.plan ?? resolveSubPlanFromNote(tx.note);
            return plan === "monthly" ? "calendar-outline" : "ribbon-outline";
        }
        default: return "receipt-outline";
    }
}

function txAmountColor(tx: WalletTx): string {
    switch (tx.transaction_type) {
        case "deposit": return "#16a34a";
        case "credit_purchase": return "#0891B2";
        case "subscription_purchase": {
            const plan = tx.subscription_snapshot?.plan ?? resolveSubPlanFromNote(tx.note);
            return plan === "monthly" ? "#16A34A" : "#7C3AED";
        }
        default: return "#dc2626";
    }
}

function txAmountPrefix(tx: WalletTx): string {
    return tx.transaction_type === "deposit" ? "+" : "-";
}

function resolveDisplayAmount(tx: WalletTx): number {
    return tx.transaction_amount ?? tx.current_balance ?? 0;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const uuId = (prefix = ""): string => {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    const rand = Array.from({ length: 10 }, () =>
        chars.charAt(Math.floor(Math.random() * chars.length))
    ).join("");
    return prefix ? `${prefix}_${rand}` : rand;
};

const formatGHS = (val: number) =>
    val.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function convertUsdToCrypto(usd: number, cryptoPriceUsd: number): number {
    if (!cryptoPriceUsd) return 0;
    return usd / cryptoPriceUsd;
}

function splitIntoColumns<T>(list: T[], rowsPerColumn: number): T[][] {
    const columns: T[][] = [];
    for (let i = 0; i < list.length; i += rowsPerColumn)
        columns.push(list.slice(i, i + rowsPerColumn));
    return columns;
}

// ─── AsyncStorage key builders ────────────────────────────────────────────────
const txCursorKey = (uid: string) => `@wallet_cursor:${uid}`;
const txCacheKey = (uid: string) => `@wallet_txcache:${uid}`;
const stripCacheKey = (uid: string) => `@wallet_strip:${uid}`;
const walletDocCacheKey = (uid: string) => `@walletdoc:${uid}`;

// ─── InlineError helper component ─────────────────────────────────────────────
/**
 * Renders a small red validation message.
 * Usage: <InlineError message={someErrorString} />
 * Renders nothing when message is empty/null/undefined.
 */
function InlineError({ message }: { message?: string }) {
    if (!message) return null;
    return (
        <Text style={inlineErrorStyle}>{message}</Text>
    );
}

const inlineErrorStyle: import("react-native").TextStyle = {
    color: "#dc2626",
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 2,
    marginTop: -4,
};

// ─── usePaginatedWallet ───────────────────────────────────────────────────────
function usePaginatedWallet(userId: string | null) {
    const [pagedTransactions, setPagedTransactions] = useState<WalletTx[]>([]);
    const [loadingPage, setLoadingPage] = useState(false);
    const [hasMore, setHasMore] = useState(true);

    const lastDocRef = useRef<QueryDocumentSnapshot | null>(null);
    const fetchingRef = useRef(false);
    const initialisedRef = useRef(false);

    const persistCursor = useCallback(async (snap: QueryDocumentSnapshot | null) => {
        if (!userId) return;
        try {
            snap
                ? await AsyncStorage.setItem(txCursorKey(userId), snap.ref.path)
                : await AsyncStorage.removeItem(txCursorKey(userId));
        } catch (e) { console.warn("persistCursor:", e); }
    }, [userId]);

    const persistCache = useCallback(async (txs: WalletTx[]) => {
        if (!userId) return;
        try {
            const safe = txs.map((t) => ({
                ...t,
                createdAt: t.createdAt?.toDate ? t.createdAt.toDate().toISOString() : t.createdAt,
            }));
            await AsyncStorage.setItem(txCacheKey(userId), JSON.stringify(safe));
        } catch (e) { console.warn("persistCache:", e); }
    }, [userId]);

    const fetchPage = useCallback(async (cursorDoc: QueryDocumentSnapshot | null) => {
        if (!userId || fetchingRef.current) return;
        fetchingRef.current = true;
        setLoadingPage(true);

        try {
            const q = cursorDoc
                ? query(
                    collection(db, TRANSACTION_WALLET_DB),
                    where("email", "==", userId),
                    orderBy("createdAt", "desc"),
                    startAfter(cursorDoc),
                    limit(TX_PAGE_SIZE)
                )
                : query(
                    collection(db, TRANSACTION_WALLET_DB),
                    where("email", "==", userId),
                    orderBy("createdAt", "desc"),
                    limit(TX_PAGE_SIZE)
                );

            const snap = await getDocs(q);
            if (snap.empty) { setHasMore(false); return; }

            const newDocs = snap.docs.map((d) => ({ id: d.id, ...d.data() } as WalletTx));
            const newLastDoc = snap.docs[snap.docs.length - 1];
            lastDocRef.current = newLastDoc;
            await persistCursor(newLastDoc);

            setPagedTransactions((prev) => {
                const seen = new Set(prev.map((t) => t.id));
                const merged = [...prev, ...newDocs.filter((t) => !seen.has(t.id))];
                persistCache(merged);
                return merged;
            });

            if (snap.docs.length < TX_PAGE_SIZE) setHasMore(false);
        } catch (err) {
            console.error("usePaginatedWallet fetchPage:", err);
        } finally {
            setLoadingPage(false);
            fetchingRef.current = false;
        }
    }, [userId, persistCursor, persistCache]);

    useEffect(() => {
        if (!userId || initialisedRef.current) return;
        initialisedRef.current = true;

        (async () => {
            try {
                const raw = await AsyncStorage.getItem(txCacheKey(userId));
                if (raw) setPagedTransactions(JSON.parse(raw));
            } catch { /* cache miss */ }

            let resolvedCursor: QueryDocumentSnapshot | null = null;
            try {
                const storedPath = await AsyncStorage.getItem(txCursorKey(userId));
                if (storedPath) {
                    const cursorSnap = await getDoc(doc(db, storedPath));
                    if (cursorSnap.exists()) {
                        resolvedCursor = cursorSnap as unknown as QueryDocumentSnapshot;
                        lastDocRef.current = resolvedCursor;
                    } else {
                        await AsyncStorage.multiRemove([txCursorKey(userId), txCacheKey(userId)]);
                        setPagedTransactions([]);
                    }
                }
            } catch (e) { console.warn("cursor resolution failed:", e); }

            await fetchPage(resolvedCursor);
        })();
    }, [userId, fetchPage]);

    const loadMore = useCallback(() => {
        if (!hasMore || loadingPage || fetchingRef.current) return;
        fetchPage(lastDocRef.current);
    }, [hasMore, loadingPage, fetchPage]);

    const resetPagination = useCallback(async () => {
        if (!userId) return;
        await AsyncStorage.multiRemove([txCursorKey(userId), txCacheKey(userId)]);
        lastDocRef.current = null;
        initialisedRef.current = false;
        setPagedTransactions([]);
        setHasMore(true);
    }, [userId]);

    return { pagedTransactions, loadingPage, hasMore, loadMore, resetPagination };
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function ProfileScreen() {
    const { userName, rawUserEmail, userId, userPhotoUrl } = useContext(GlobalContext);

    useFocusEffect(
        useCallback(() => { if (!userId) router.replace("/"); }, [userId])
    );

    const { height } = useWindowDimensions();
    const seasonListMaxHeight = height - height * 0.32;

    // ── Member / profile ─────────────────────────────────────────────────────
    const [member, setMember] = useState<any>(null);
    const [loadingProfile, setLoadingProfile] = useState(true);
    const CACHE_KEY = UserStorageKeys.memberData(userId);

    // ── Wallet strip ──────────────────────────────────────────────────────────
    const [walletBalance, setWalletBalance] = useState(0);
    const [transactions, setTransactions] = useState<WalletTx[]>([]);
    const [pendingCount, setPendingCount] = useState(0);
    const [reloading, setReloading] = useState(false);

    // ── Paginated history ─────────────────────────────────────────────────────
    const { pagedTransactions, loadingPage, hasMore, loadMore, resetPagination } =
        usePaginatedWallet(userId ?? null);

    // ── Personal details panel ────────────────────────────────────────────────
    const [showPersonal, setShowPersonal] = useState(false);
    const [editingPersonal, setEditingPersonal] = useState(false);
    const [savingPersonal, setSavingPersonal] = useState(false);
    const [personalSaved, setPersonalSaved] = useState(false);
    const [personalError, setPersonalError] = useState("");
    const [personalForm, setPersonalForm] = useState<PersonalForm>({
        actualFullname: "",
        actualDayOfBirth: "",
        actualMonthOfBirth: "",
        actualYearOfBirth: "",
        actualGender: "",
        phone: "",
    });
    const panelAnim = useRef(new Animated.Value(0)).current;

    // ── Deposit ───────────────────────────────────────────────────────────────
    const [depositMethod, setDepositMethod] = useState<PaymentMethodKey | null>(null);
    const [depositAmount, setDepositAmount] = useState("");
    const [depositTxId, setDepositTxId] = useState("");
    const [depositStatus, setDepositStatus] = useState<"idle" | "submitting" | "success" | "failed">("idle");

    // Deposit inline validation errors
    const [depositAmountError, setDepositAmountError] = useState("");
    const [depositMethodError, setDepositMethodError] = useState("");
    const [depositTxIdError, setDepositTxIdError] = useState("");

    // ── Withdrawal ────────────────────────────────────────────────────────────
    const [withdrawAmount, setWithdrawAmount] = useState("");
    const [withdrawMethod, setWithdrawMethod] = useState<WithdrawMethodKey | null>(null);
    const [withdrawAccountInfo, setWithdrawAccountInfo] = useState("");
    const [withdrawOperator, setWithdrawOperator] = useState("");
    const [withdrawCountry, setWithdrawCountry] = useState<WithdrawCountry>(WITHDRAW_COUNTRIES[0]);
    const [showCountryPicker, setShowCountryPicker] = useState(false);
    const [withdrawStatus, setWithdrawStatus] = useState<"idle" | "submitting" | "success" | "failed">("idle");
    const [withdrawMessage, setWithdrawMessage] = useState("");

    // Withdrawal inline validation errors
    const [withdrawMethodError, setWithdrawMethodError] = useState("");
    const [withdrawAmountError, setWithdrawAmountError] = useState("");
    const [withdrawAccountError, setWithdrawAccountError] = useState("");
    const [withdrawOperatorError, setWithdrawOperatorError] = useState("");

    // ── P2P ───────────────────────────────────────────────────────────────────
    const [p2pRecipientEmail, setP2pRecipientEmail] = useState("");
    const [p2pRecipientData, setP2pRecipientData] = useState<any>(null);
    const [lookingUpRecipient, setLookingUpRecipient] = useState(false);
    const [recipientError, setRecipientError] = useState("");
    const [p2pAmount, setP2pAmount] = useState("");
    const [p2pStatus, setP2pStatus] = useState<"idle" | "submitting" | "success" | "failed">("idle");
    const [p2pError, setP2pError] = useState("");
    const isTransferring = useRef(false);

    // P2P inline validation errors (split by field)
    const [p2pAmountError, setP2pAmountError] = useState("");
    const [p2pSenderError, setP2pSenderError] = useState("");

    // ── Crypto ────────────────────────────────────────────────────────────────
    const [cryptoList, setCryptoList] = useState<CryptoItem[]>([]);
    const [ethPrice, setEthPrice] = useState<number>(0);
    const [selectedCrypto, setSelectedCrypto] = useState("ETH");
    const [convertedToCrypto, setConvertedToCrypto] = useState(0);
    const [showDropdown, setShowDropdown] = useState(false);
    const [loadingCrypto, setLoadingCrypto] = useState(true);

    // ── Active card ───────────────────────────────────────────────────────────
    type ActiveCard = "wallet" | "deposit" | "withdraw" | "p2p" | "history";
    const [activeCard, setActiveCard] = useState<ActiveCard>("wallet");

    // ─────────────────────────────────────────────────────────────────────────
    //  fetchWalletBalance
    // ─────────────────────────────────────────────────────────────────────────
    const fetchWalletBalance = useCallback(async (showSpinner: boolean) => {
        if (!userId) return;
        if (showSpinner) setReloading(true);

        if (!showSpinner) {
            try {
                const cached = await AsyncStorage.getItem(walletDocCacheKey(userId));
                if (cached) {
                    const walletDoc: WalletDoc = JSON.parse(cached);
                    setWalletBalance(walletDoc.current_balance ?? 0);
                }
            } catch { /* ignore */ }

            try {
                const cached = await AsyncStorage.getItem(stripCacheKey(userId));
                if (cached) {
                    const txs: WalletTx[] = JSON.parse(cached);
                    setTransactions(txs);
                    setPendingCount(txs.filter((t) => t.transaction_status === "pending approval").length);
                }
            } catch { /* ignore */ }
        }

        try {
            const walletSnap = await getDoc(doc(db, WALLET_DB, userId));
            if (walletSnap.exists()) {
                const walletDoc = walletSnap.data() as WalletDoc;
                const balance = walletDoc.current_balance ?? 0;
                setWalletBalance(balance);
                try {
                    await AsyncStorage.setItem(walletDocCacheKey(userId), JSON.stringify(walletDoc));
                } catch { /* ignore */ }
            }

            const q = query(
                collection(db, TRANSACTION_WALLET_DB),
                where("email", "==", userId),
                orderBy("createdAt", "desc"),
                limit(STRIP_FETCH_LIMIT)
            );
            const snap = await getDocs(q);
            const txs = snap.docs.map((d) => ({ id: d.id, ...d.data() } as WalletTx));
            setTransactions(txs);
            setPendingCount(txs.filter((t) => t.transaction_status === "pending approval").length);

            try {
                const safe = txs.map((t) => ({
                    ...t,
                    createdAt: t.createdAt?.toDate ? t.createdAt.toDate().toISOString() : t.createdAt,
                }));
                await AsyncStorage.setItem(stripCacheKey(userId), JSON.stringify(safe));
            } catch { /* ignore */ }

        } catch (err) {
            console.error("fetchWalletBalance:", err);
        } finally {
            if (showSpinner) setReloading(false);
        }
    }, [userId]);

    useEffect(() => { fetchWalletBalance(false); }, [fetchWalletBalance]);

    useFocusEffect(
        useCallback(() => { fetchWalletBalance(false); }, [fetchWalletBalance])
    );

    // ── Member profile fetch (cache-first) ────────────────────────────────────
    const fetchProfile = useCallback(async () => {
        if (!userId) return;
        try {
            const cached = await AsyncStorage.getItem(CACHE_KEY);
            if (cached) {
                const parsed = JSON.parse(cached);
                setMember(parsed);
                syncPersonalForm(parsed);
                setLoadingProfile(false);
            }
            const snap = await getDoc(doc(db, MEMBERS_DB, userId));
            if (snap.exists()) {
                const fresh = snap.data();
                setMember(fresh);
                syncPersonalForm(fresh);
                await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(fresh));
            }
        } catch (err) {
            console.error("fetchProfile:", err);
        } finally {
            setLoadingProfile(false);
        }
    }, [userId, CACHE_KEY]);

    useEffect(() => { fetchProfile(); }, [fetchProfile]);

    const syncPersonalForm = (data: any) => {
        setPersonalForm({
            actualFullname: data.actualFullname ?? "",
            actualDayOfBirth: data.actualDayOfBirth ?? "",
            actualMonthOfBirth: data.actualMonthOfBirth ?? "",
            actualYearOfBirth: data.actualYearOfBirth ?? "",
            actualGender: data.actualGender ?? "",
            phone: data.phone ?? "",
        });
    };

    // ── Personal details panel toggle ─────────────────────────────────────────
    const togglePersonal = () => {
        const next = !showPersonal;
        setShowPersonal(next);
        setEditingPersonal(false);
        Animated.spring(panelAnim, {
            toValue: next ? 1 : 0,
            tension: 60,
            friction: 10,
            useNativeDriver: false,
        }).start();
    };

    // ── Save personal details ─────────────────────────────────────────────────
    const handleSavePersonal = async () => {
        if (!personalForm.actualFullname.trim()) {
            setPersonalError("Full legal name cannot be empty.");
            return;
        }
        setSavingPersonal(true);
        setPersonalError("");
        try {
            const payload = {
                actualFullname: personalForm.actualFullname.trim(),
                actualDayOfBirth: personalForm.actualDayOfBirth.trim(),
                actualMonthOfBirth: personalForm.actualMonthOfBirth.trim(),
                actualYearOfBirth: personalForm.actualYearOfBirth.trim(),
                actualGender: personalForm.actualGender.trim(),
                phone: personalForm.phone.trim(),
            };
            await updateDoc(doc(db, MEMBERS_DB, userId), payload);
            const updated = { ...member, ...payload };
            setMember(updated);
            await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(updated));
            setEditingPersonal(false);
            setPersonalSaved(true);
            setTimeout(() => setPersonalSaved(false), 3000);
        } catch {
            setPersonalError("Failed to save. Please try again.");
        } finally {
            setSavingPersonal(false);
        }
    };

    // ── Crypto prices ─────────────────────────────────────────────────────────
    useEffect(() => {
        (async () => {
            try {
                const ids = Object.values(COINGECKO_IDS).join(",");
                const res = await fetch(
                    `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`
                );
                if (!res.ok) throw new Error("Price fetch failed");
                const data: Record<string, { usd: number }> = await res.json();
                const prices: Record<string, number> = {};
                for (const [symbol, id] of Object.entries(COINGECKO_IDS))
                    prices[symbol] = data[id]?.usd ?? 0;
                setEthPrice(prices.ETH ?? 0);
                setCryptoList([
                    { name: "BTC", symbol: "BTC", value: prices.BTC },
                    { name: "ETH", symbol: "ETH", value: prices.ETH },
                    { name: "BNB", symbol: "BNB", value: prices.BNB },
                    { name: "USD", symbol: "USD", value: 1 },
                    { name: "USDT", symbol: "USDT", value: 1 },
                    { name: "USDC", symbol: "USDC", value: 1 },
                    { name: "XDC", symbol: "XDC", value: prices.XDC },
                    { name: "ADA", symbol: "ADA", value: prices.ADA },
                    { name: "ALGO", symbol: "ALGO", value: prices.ALGO },
                ]);
            } catch (err) {
                console.warn("Crypto prices unavailable:", err);
            } finally {
                setLoadingCrypto(false);
            }
        })();
    }, []);

    // ─────────────────────────────────────────────────────────────────────────
    //  handleDeposit
    //  Validation errors are surfaced inline above each field.
    //  No Alert.alert calls.
    // ─────────────────────────────────────────────────────────────────────────
    const handleDeposit = async () => {
        // Reset all deposit errors before re-validating
        setDepositAmountError("");
        setDepositMethodError("");
        setDepositTxIdError("");

        let hasError = false;

        if (!depositMethod) {
            setDepositMethodError("Please choose a payment method.");
            hasError = true;
        }
        if (!depositAmount || Number(depositAmount) <= 0) {
            setDepositAmountError("Please enter a valid deposit amount.");
            hasError = true;
        }
        if (!depositTxId.trim()) {
            setDepositTxIdError("Please paste your payment transaction ID.");
            hasError = true;
        }

        if (hasError) return;

        setDepositStatus("submitting");
        try {
            const depositAmt = Number(depositAmount);
            const txId = uuId(userId);

            await addDoc(collection(db, TRANSACTION_WALLET_DB), {
                email: userId,
                transaction_id: txId,
                external_transaction_id: depositTxId.trim(),
                transaction_type: "deposit",
                previous_balance: walletBalance,
                current_balance: walletBalance + depositAmt,
                transaction_amount: depositAmt,
                transaction_status: "pending approval",
                currency: "GHS",
                payment_method: depositMethod,
                note: `Deposit via ${depositMethod} — awaiting admin confirmation`,
                createdAt: serverTimestamp(),
            });

            setDepositStatus("success");
            setDepositAmount("");
            setDepositTxId("");
            setDepositMethod(null);
            await fetchWalletBalance(false);
            await resetPagination();

            // Notify admin — don't let a notification failure affect deposit success
            try {
                await fetch(
                    "https://email-service-570014654568.us-central1.run.app/push_notification",
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            title: "New Deposit Pending Approval",
                            body: `Request to deposit ${depositAmt} GHS via ${depositMethod}`,
                            data: {
                                screen: "chat/profile",
                                transactionId: txId,
                            },
                        }),
                    }
                );
            } catch (notifyErr) {
                console.log("Admin notification error:", notifyErr);
            }
        } catch (err) {
            console.error("Deposit error:", err);
            setDepositStatus("failed");
        }
    };

    // ─────────────────────────────────────────────────────────────────────────
    //  handleWithdraw
    //  Validation errors surfaced inline. No Alert.alert calls.
    // ─────────────────────────────────────────────────────────────────────────
    const handleWithdraw = async () => {
        setWithdrawMethodError("");
        setWithdrawAmountError("");
        setWithdrawAccountError("");
        setWithdrawOperatorError("");

        const amount = Number(withdrawAmount);
        const cfg = withdrawMethod ? WITHDRAW_METHOD_CONFIGS[withdrawMethod] : null;

        let hasError = false;

        if (!withdrawMethod || !cfg) {
            setWithdrawMethodError("Please choose a withdrawal method.");
            hasError = true;
        } else {
            if (!amount || amount < cfg.minGHS) {
                setWithdrawAmountError(
                    `Minimum withdrawal via ${cfg.label} is GHS ${formatGHS(cfg.minGHS)}.`
                );
                hasError = true;
            } else if (amount > cfg.maxGHS) {
                setWithdrawAmountError(
                    `Maximum withdrawal via ${cfg.label} is GHS ${formatGHS(cfg.maxGHS)}.`
                );
                hasError = true;
            } else if (amount > walletBalance) {
                setWithdrawAmountError(
                    `Insufficient balance. Available: GHS ${formatGHS(walletBalance)}.`
                );
                hasError = true;
            }

            if (!withdrawAccountInfo.trim()) {
                setWithdrawAccountError(
                    `Please enter your ${cfg.accountLabel.toLowerCase()}.`
                );
                hasError = true;
            }

            if (cfg.hasOperator && !withdrawOperator) {
                setWithdrawOperatorError("Please select your bank or network operator.");
                hasError = true;
            }
        }

        if (hasError) return;

        const { fee, net } = calcWithdrawFee(amount, withdrawMethod!);

        setWithdrawStatus("submitting");
        setWithdrawMessage("");
        try {
            await addDoc(collection(db, TRANSACTION_WALLET_DB), {
                email: userId,
                transaction_id: uuId(userId),
                external_transaction_id: "",
                transaction_type: "withdrawal",
                previous_balance: walletBalance,
                current_balance: walletBalance - amount,
                transaction_amount: amount,
                fee_amount: fee,
                net_amount: net,
                transaction_status: "pending approval",
                currency: "GHS",
                payment_method: withdrawMethod,
                withdrawal_destination: withdrawAccountInfo.trim(),
                withdrawal_operator: withdrawOperator || null,
                withdrawal_country: withdrawCountry.code,
                withdrawal_country_name: withdrawCountry.name,
                withdrawal_currency: withdrawCountry.currency,
                note: `Withdrawal GHS ${formatGHS(amount)} (fee: GHS ${formatGHS(fee)}, net: GHS ${formatGHS(net)}) via ${cfg!.label}${withdrawOperator ? ` (${withdrawOperator})` : ""} → ${withdrawAccountInfo.trim()} [${withdrawCountry.flag} ${withdrawCountry.name}]`,
                createdAt: serverTimestamp(),
            });

            setWithdrawStatus("success");
            setWithdrawMessage(
                `Withdrawal of GHS ${formatGHS(net)} (after GHS ${formatGHS(fee)} fee) submitted — pending admin approval.`
            );
            setWithdrawAmount("");
            setWithdrawMethod(null);
            setWithdrawAccountInfo("");
            setWithdrawOperator("");
            await fetchWalletBalance(false);
            await resetPagination();
        } catch (err) {
            console.error("Withdraw error:", err);
            setWithdrawStatus("failed");
            setWithdrawMessage("Withdrawal failed. Please try again.");
        }
    };

    // ── P2P recipient lookup ──────────────────────────────────────────────────
    const handleLookupRecipient = async () => {
        const email = p2pRecipientEmail.trim().toLowerCase();
        if (!email) return;
        if (email === rawUserEmail?.trim().toLowerCase()) {
            setRecipientError("You cannot transfer to yourself.");
            return;
        }
        setLookingUpRecipient(true);
        setRecipientError("");
        setP2pRecipientData(null);
        try {
            const snap = await getDoc(doc(db, MEMBERS_DB, email));
            snap.exists()
                ? setP2pRecipientData(snap.data())
                : setRecipientError("No account found for that email.");
        } catch {
            setRecipientError("Lookup failed. Check your connection.");
        } finally {
            setLookingUpRecipient(false);
        }
    };

    // ─────────────────────────────────────────────────────────────────────────
    //  handleP2PTransfer
    //  Validation errors surfaced inline. No Alert.alert calls.
    // ─────────────────────────────────────────────────────────────────────────
    const handleP2PTransfer = async () => {
        if (isTransferring.current) return;

        // Reset P2P field-level errors
        setP2pAmountError("");
        setP2pSenderError("");
        setP2pError("");

        const amount = Number(p2pAmount);

        if (!p2pRecipientData) {
            setRecipientError("Look up the recipient first.");
            return;
        }
        if (amount < MIN_P2P) {
            setP2pAmountError(`Minimum transfer is GHS ${MIN_P2P}.`);
            return;
        }
        if (amount > walletBalance) {
            setP2pAmountError(`Insufficient balance. Available: GHS ${formatGHS(walletBalance)}.`);
            return;
        }

        const senderEmail = rawUserEmail?.trim().toLowerCase();
        if (!senderEmail) {
            setP2pSenderError("Unable to identify sender. Please sign in again.");
            return;
        }

        isTransferring.current = true;
        setP2pStatus("submitting");

        const receiverEmail = p2pRecipientEmail.trim().toLowerCase();

        try {
            let recipientCurrentBalance = 0;
            try {
                const recipientWalletSnap = await getDoc(doc(db, WALLET_DB, receiverEmail));
                if (recipientWalletSnap.exists()) {
                    recipientCurrentBalance =
                        (recipientWalletSnap.data() as WalletDoc).current_balance ?? 0;
                }
            } catch (e) {
                console.warn("Could not read recipient WALLET_DB; defaulting to 0:", e);
            }

            const sharedRefGroup = uuId("P2P");

            await addDoc(collection(db, TRANSACTION_WALLET_DB), {
                email: senderEmail,
                transaction_id: `SEND_${sharedRefGroup}`,
                external_transaction_id: "",
                transaction_type: "P2P_money_transfer",
                previous_balance: walletBalance,
                current_balance: walletBalance - amount,
                transaction_amount: amount,
                transaction_status: "completed",
                currency: "GHS",
                payment_method: "system transfer",
                counterpartyEmail: receiverEmail,
                counterpartyName: p2pRecipientData?.clientName ?? receiverEmail,
                note: `Transferred GHS ${formatGHS(amount)} to ${receiverEmail}`,
                createdAt: serverTimestamp(),
            });

            await addDoc(collection(db, TRANSACTION_WALLET_DB), {
                email: receiverEmail,
                transaction_id: `RECV_${sharedRefGroup}`,
                external_transaction_id: "",
                transaction_type: "P2P_money_transfer",
                previous_balance: recipientCurrentBalance,
                current_balance: recipientCurrentBalance + amount,
                transaction_amount: amount,
                transaction_status: "completed",
                currency: "GHS",
                payment_method: "system transfer",
                counterpartyEmail: senderEmail,
                counterpartyName: userName ?? senderEmail,
                note: `Received GHS ${formatGHS(amount)} from ${senderEmail}`,
                createdAt: serverTimestamp(),
            });

            setP2pStatus("success");
            setP2pAmount("");
            setP2pRecipientEmail("");
            setP2pRecipientData(null);
            await fetchWalletBalance(false);
            await resetPagination();
        } catch (err: any) {
            console.error("P2P Error:", err);
            setP2pError("Transfer failed. Please check your connection.");
            setP2pStatus("failed");
        } finally {
            isTransferring.current = false;
        }
    };

    const handleSelectCrypto = (item: CryptoItem) => {
        setSelectedCrypto(item.name);
        setConvertedToCrypto(
            item.value > 0
                ? item.name === "USD"
                    ? walletBalance / 10
                    : walletBalance / item.value
                : 0
        );
        setShowDropdown(false);
    };

    // ── Derived display values ────────────────────────────────────────────────
    const createdAt = member?.createdAt ?? "";
    const badges = member?.badges ?? 0;
    const avatarColor = member?.iconUrl?.color ?? "#ff7f2a";

    // ── Loading splash ────────────────────────────────────────────────────────
    if (loadingProfile && !member) {
        return (
            <View style={styles.loaderContainer}>
                <ActivityIndicator size="large" color="#F97316" />
            </View>
        );
    }

    // ── Withdrawal status helpers ─────────────────────────────────────────────
    const latestWithdrawal = transactions.find((t) => t.transaction_type === "withdrawal");
    const withdrawalTxStatus = latestWithdrawal?.transaction_status ?? "";

    const getWithdrawStatusColor = (): string => {
        switch (withdrawalTxStatus) {
            case "completed": return "#16a34a";
            case "pending approval": return "#d97706";
            case "failed": return "#dc2626";
            case "cancelled": return "#dc2626";
            default: return "#999";
        }
    };

    const getWithdrawStatusLabel = () => {
        if (withdrawStatus === "submitting") return "Submitting withdrawal…";
        if (withdrawStatus === "success") return withdrawMessage;
        if (withdrawStatus === "failed") return withdrawMessage;
        switch (withdrawalTxStatus) {
            case "pending approval": return "⏳ Withdrawal pending admin approval…";
            case "completed": return "✅ Withdrawal approved & completed.";
            case "failed": return "❌ Withdrawal failed.";
            case "cancelled": return "❌ Withdrawal cancelled.";
            default: return withdrawAmount ? "Ready to submit." : "Idle…";
        }
    };

    const pendingTransactions = transactions.filter(
        (t) => t.transaction_status === "pending approval"
    );

    // ── DOB / gender display helpers ──────────────────────────────────────────
    const dobDisplay = (() => {
        const { actualDayOfBirth: d, actualMonthOfBirth: m, actualYearOfBirth: y } = member ?? {};
        return d && m && y ? `${d}/${m}/${y}` : "—";
    })();

    const genderDisplay = (g: string) =>
        g === "prefer_not_to_say"
            ? "Prefer not to say"
            : g ? g.charAt(0).toUpperCase() + g.slice(1) : "—";

    // ─────────────────────────────────────────────────────────────────────────
    //  Render
    // ─────────────────────────────────────────────────────────────────────────
    return (
        <ReusableScreen>
            <ChatBanner />
            <SafeAreaView style={styles.container}>
                <View style={{ flex: 1, width: "100%" }}>


                    {/* ══════════════ CARD TOP ══════════════ */}
                    <View style={styles.cardTop}>

                        {/* ── Header row ── */}
                        <View style={styles.headerRow}>
                            <View style={styles.headerLeft}>
                                <TouchableOpacity onPress={() => router.back()}>
                                    <Ionicons name="arrow-back" size={25} color="#000" />
                                </TouchableOpacity>
                                <Text
                                    numberOfLines={1}
                                    ellipsizeMode="tail"
                                    style={[styles.profileName, { width: 150 }]}
                                >
                                    {userName}
                                </Text>
                            </View>

                            <View style={{ flexDirection: "row", alignItems: "center" }}>
                                <TouchableOpacity
                                    style={styles.refreshButton}
                                    onPress={() => fetchWalletBalance(true)}
                                    disabled={reloading}
                                    activeOpacity={0.75}
                                >
                                    {reloading ? (
                                        <ActivityIndicator size="small" color="#fff" />
                                    ) : (
                                        <Text style={styles.refreshButtonText}>Reload</Text>
                                    )}
                                </TouchableOpacity>

                                <PopupMenu />
                            </View>
                        </View>

                        {/* ── Profile row ── */}
                        <View style={styles.profileRow}>
                            <View style={styles.profileLeft}>
                                <View>
                                    <Image
                                        source={require("@/assets/images/userImagePlaceHolder.png")}
                                        style={{ width: "70%", height: "70%", position: "absolute" }}
                                        resizeMode="cover"
                                    />
                                    <Image source={{ uri: userPhotoUrl }} style={styles.avatar} />
                                </View>

                                <View style={{ flex: 1 }}>
                                    <View style={styles.contactRow}>
                                        <Feather name="mail" size={18} color="#6b6b6b" />
                                        <Text
                                            numberOfLines={1}
                                            ellipsizeMode="tail"
                                            style={[styles.contactText, { width: 150 }]}
                                        >
                                            {rawUserEmail}
                                        </Text>
                                    </View>

                                    <View style={styles.contactRow}>
                                        <Feather name="plus-square" size={18} color="#6b6b6b" />
                                        <Text style={styles.profileMeta}>
                                            Joined: {createdAt ? getTimeAgo(createdAt) : "—"}
                                        </Text>
                                    </View>

                                    {pendingCount > 0 && (
                                        <View style={styles.pendingBadgeRow}>
                                            <Ionicons name="time-outline" size={14} color="#d97706" />
                                            <Text style={styles.pendingBadgeText}>
                                                {pendingCount} transaction{pendingCount !== 1 ? "s" : ""} pending
                                            </Text>
                                        </View>
                                    )}

                                    {/* ── Personal details toggle ── */}
                                    <TouchableOpacity
                                        style={styles.personalToggle}
                                        onPress={togglePersonal}
                                        activeOpacity={0.7}
                                    >
                                        <Feather name="user" size={18} color="#6b6b6b" />
                                        <Text style={styles.personalToggleText}>
                                            {showPersonal ? "Hide details" : "Personal details"}
                                        </Text>
                                        <Ionicons
                                            name={showPersonal ? "chevron-up" : "chevron-down"}
                                            size={13}
                                            color="#999"
                                            style={{ marginLeft: "auto" }}
                                        />
                                    </TouchableOpacity>

                                    {/* ── Personal details panel ── */}
                                    {showPersonal && (
                                        <View style={styles.personalPanel}>
                                            {!editingPersonal ? (
                                                <>
                                                    {[
                                                        { icon: "user-check" as const, label: "Name", value: member?.actualFullname || "—" },
                                                        { icon: "calendar" as const, label: "Birthday", value: dobDisplay },
                                                        { icon: "users" as const, label: "Gender", value: genderDisplay(member?.actualGender ?? "") },
                                                        { icon: "phone" as const, label: "Phone", value: member?.phone || "—" },
                                                    ].map(({ icon, label, value }) => (
                                                        <View key={label} style={styles.pdRow}>
                                                            <Feather name={icon} size={12} color="#9ca3af" style={{ width: 16 }} />
                                                            <Text style={styles.pdLabel}>{label}</Text>
                                                            <Text style={styles.pdValue} numberOfLines={1}>{value}</Text>
                                                        </View>
                                                    ))}
                                                    {personalSaved && (
                                                        <Text style={styles.pdSaved}>✓ Saved</Text>
                                                    )}
                                                    <TouchableOpacity
                                                        style={styles.pdEditBtn}
                                                        onPress={() => setEditingPersonal(true)}
                                                    >
                                                        <Feather name="edit-2" size={11} color="#1f6feb" />
                                                        <Text style={styles.pdEditBtnText}>Edit</Text>
                                                    </TouchableOpacity>
                                                </>
                                            ) : (
                                                <>
                                                    <Text style={styles.pdFieldLabel}>Full legal name</Text>
                                                    <InlineError message={personalError} />
                                                    <TextInput
                                                        style={[styles.pdInput, Platform.OS === "web" && (styles.webInput as any)]}
                                                        value={personalForm.actualFullname}
                                                        onChangeText={(v) => {
                                                            setPersonalForm((p) => ({ ...p, actualFullname: v }));
                                                            if (personalError) setPersonalError("");
                                                        }}
                                                        autoCapitalize="words"
                                                        placeholder="First and last name"
                                                        placeholderTextColor="#9ca3af"
                                                        maxLength={100}
                                                    />
                                                    <Text style={styles.pdFieldLabel}>Phone</Text>
                                                    <TextInput
                                                        style={[styles.pdInput, Platform.OS === "web" && (styles.webInput as any)]}
                                                        value={personalForm.phone}
                                                        onChangeText={(v) => setPersonalForm((p) => ({ ...p, phone: v }))}
                                                        keyboardType="phone-pad"
                                                        placeholder="+233 XX XXX XXXX"
                                                        placeholderTextColor="#9ca3af"
                                                        maxLength={16}
                                                    />
                                                    <Text style={styles.pdFieldLabel}>Date of birth</Text>
                                                    <View style={styles.pdDobRow}>
                                                        <TextInput
                                                            style={[styles.pdDobInput, Platform.OS === "web" && (styles.webInput as any)]}
                                                            value={personalForm.actualDayOfBirth}
                                                            onChangeText={(v) => setPersonalForm((p) => ({ ...p, actualDayOfBirth: v }))}
                                                            keyboardType="numeric"
                                                            maxLength={2}
                                                            placeholder="DD"
                                                            placeholderTextColor="#9ca3af"
                                                        />
                                                        <Text style={styles.pdDobSep}>/</Text>
                                                        <TextInput
                                                            style={[styles.pdDobInput, Platform.OS === "web" && (styles.webInput as any)]}
                                                            value={personalForm.actualMonthOfBirth}
                                                            onChangeText={(v) => setPersonalForm((p) => ({ ...p, actualMonthOfBirth: v }))}
                                                            keyboardType="numeric"
                                                            maxLength={2}
                                                            placeholder="MM"
                                                            placeholderTextColor="#9ca3af"
                                                        />
                                                        <Text style={styles.pdDobSep}>/</Text>
                                                        <TextInput
                                                            style={[styles.pdDobInputYear, Platform.OS === "web" && (styles.webInput as any)]}
                                                            value={personalForm.actualYearOfBirth}
                                                            onChangeText={(v) => setPersonalForm((p) => ({ ...p, actualYearOfBirth: v }))}
                                                            keyboardType="numeric"
                                                            maxLength={4}
                                                            placeholder="YYYY"
                                                            placeholderTextColor="#9ca3af"
                                                        />
                                                    </View>
                                                    <Text style={styles.pdFieldLabel}>Gender</Text>
                                                    <View style={styles.pdGenderRow}>
                                                        {GENDER_OPTIONS.map((g) => (
                                                            <TouchableOpacity
                                                                key={g}
                                                                style={[
                                                                    styles.pdGenderChip,
                                                                    personalForm.actualGender === g && styles.pdGenderChipActive,
                                                                ]}
                                                                onPress={() => setPersonalForm((p) => ({ ...p, actualGender: g }))}
                                                            >
                                                                <Text
                                                                    style={[
                                                                        styles.pdGenderChipText,
                                                                        personalForm.actualGender === g && styles.pdGenderChipTextActive,
                                                                    ]}
                                                                >
                                                                    {g === "prefer_not_to_say" ? "Prefer not" : g.charAt(0).toUpperCase() + g.slice(1)}
                                                                </Text>
                                                            </TouchableOpacity>
                                                        ))}
                                                    </View>
                                                    <View style={styles.pdSaveRow}>
                                                        <TouchableOpacity
                                                            style={styles.pdCancelBtn}
                                                            onPress={() => { setEditingPersonal(false); setPersonalError(""); }}
                                                        >
                                                            <Text style={styles.pdCancelText}>Cancel</Text>
                                                        </TouchableOpacity>
                                                        <TouchableOpacity
                                                            style={[styles.pdSaveBtn, savingPersonal && styles.pdSaveBtnDisabled]}
                                                            onPress={handleSavePersonal}
                                                            disabled={savingPersonal}
                                                        >
                                                            {savingPersonal
                                                                ? <ActivityIndicator size="small" color="#fff" />
                                                                : <Text style={styles.pdSaveText}>Save</Text>
                                                            }
                                                        </TouchableOpacity>
                                                    </View>
                                                </>
                                            )}
                                        </View>
                                    )}

                                    <TouchableOpacity
                                        style={styles.personalToggle}
                                        onPress={() => router.navigate("./UserTransactionScreen")}
                                        activeOpacity={0.7}
                                    >
                                        <Feather name="zap" size={18} color="#6b6b6b" />
                                        <Text style={styles.viewAllTransactionsText}>View all transactions</Text>
                                    </TouchableOpacity>
                                </View>
                            </View>
                        </View>

                        {/* ── Badges + Balance strip ── */}
                        <View style={styles.badgeBalanceStrip}>
                            <View style={styles.badgeLeft}>
                                <View style={styles.badgePill}>
                                    <Text style={styles.badgePillText}>Badges</Text>
                                </View>
                                <Text style={styles.pointsText}>{badges}</Text>
                            </View>
                            <View style={styles.balanceRight}>
                                <Text style={{ fontSize: 19 }}>Ghs {walletBalance}</Text>
                                <View style={styles.balancePill}>
                                    <Text style={styles.balancePillText}>${walletBalance / 10}</Text>
                                </View>
                            </View>
                        </View>

                        {/* ── Scrollable cards area ── */}
                        <View style={styles.scrollArea}>
                            <ScrollView
                                style={{ maxHeight: seasonListMaxHeight }}
                                contentContainerStyle={styles.scrollContent}
                                showsVerticalScrollIndicator={false}
                                keyboardShouldPersistTaps="handled"
                                keyboardDismissMode="on-drag"
                            >
                                {/* Crypto dropdown */}
                                {showDropdown && (
                                    <View style={styles.dropdown}>
                                        <View style={styles.columns}>
                                            {splitIntoColumns(cryptoList, 4).map((column, ci) => (
                                                <View key={`col-${ci}`} style={styles.column}>
                                                    {column.map((item) => (
                                                        <TouchableOpacity
                                                            key={item.symbol}
                                                            style={styles.dropdownItem}
                                                            onPress={() => handleSelectCrypto(item)}
                                                        >
                                                            <Text style={styles.dropdownText}>{item.symbol}</Text>
                                                        </TouchableOpacity>
                                                    ))}
                                                </View>
                                            ))}
                                        </View>
                                    </View>
                                )}

                                {/* ════ CRYPTO WALLET ════ */}
                                <Pressable onPress={() => setShowDropdown(false)}>
                                    <View style={styles.card}>
                                        <View style={styles.cardHeader}>
                                            <Ionicons name="wallet-outline" size={18} color="#444" />
                                            <Text style={styles.cardHeaderText}>Crypto Wallet</Text>
                                        </View>
                                        <View style={styles.cardBody}>
                                            <View style={styles.cardInfoRow}>
                                                <Ionicons name="compass" size={22} color="#444" />
                                                <View style={{ flexDirection: "column", gap: 6 }}>
                                                    <Text style={styles.cardInfoLabel}>Your Ethereum Address (ERC-20):</Text>
                                                    <Text style={styles.cardInfoMono}>0x77b34**********6e89**64a5*****</Text>
                                                </View>
                                            </View>
                                            <View style={styles.cardInfoRow}>
                                                <Ionicons name="options-outline" size={18} color="#444" />
                                                <View style={styles.cryptoBalRow}>
                                                    <Text style={styles.cardInfoLabel}>Crypto Bal :</Text>
                                                    {loadingCrypto ? (
                                                        <ActivityIndicator size="small" color="#888" />
                                                    ) : (
                                                        <View style={styles.currencyRow}>
                                                            <Text style={styles.cryptoValue}>
                                                                {convertedToCrypto
                                                                    ? convertedToCrypto.toFixed(5)
                                                                    : convertUsdToCrypto(walletBalance, ethPrice).toFixed(6)}{" "}
                                                            </Text>
                                                            <View style={styles.currencyWrapper}>
                                                                <Text style={styles.currencyText}>{selectedCrypto}</Text>
                                                                <TouchableOpacity
                                                                    activeOpacity={0.7}
                                                                    onPress={() => setShowDropdown((v) => !v)}
                                                                >
                                                                    <Ionicons name="chevron-down-circle" size={22} color="#000" />
                                                                </TouchableOpacity>
                                                            </View>
                                                        </View>
                                                    )}
                                                </View>
                                            </View>
                                            <View style={styles.cardInfoRow}>
                                                <Ionicons name="checkbox" size={18} color="#444" />
                                                <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap" }}>
                                                    <Text style={[styles.cardInfoLabel, { color: "#1b9702", fontWeight: "800", fontSize: 18 }]}>Bal : </Text>
                                                    <Text style={{ fontWeight: "800", fontSize: 18, color: "#000" }}>ETH </Text>
                                                    <Text style={{ fontWeight: "800", fontSize: 18, color: "#f49803" }}>
                                                        {ethPrice ? convertUsdToCrypto(walletBalance, ethPrice).toFixed(6) : "0.000000"}
                                                    </Text>
                                                    <Text style={{ fontWeight: "800", fontSize: 16, color: "#000" }}>
                                                        {" "}(GHS{walletBalance.toFixed(2)})
                                                    </Text>
                                                </View>
                                            </View>
                                        </View>
                                    </View>
                                </Pressable>

                                {/* ════ DEPOSIT ════ */}
                                <Pressable onPress={() => setShowDropdown(false)}>
                                    <View style={styles.card}>
                                        <TouchableOpacity
                                            style={styles.cardHeader}
                                            onPress={() => setActiveCard(activeCard === "deposit" ? "wallet" : "deposit")}
                                            activeOpacity={0.7}
                                        >
                                            <Ionicons name="arrow-down-circle-outline" size={18} color="#444" />
                                            <Text style={styles.cardHeaderText}>Deposit Funds</Text>
                                            <Ionicons
                                                name={activeCard === "deposit" ? "chevron-up" : "chevron-down"}
                                                size={18} color="#888" style={{ marginLeft: "auto" }}
                                            />
                                        </TouchableOpacity>
                                        {activeCard === "deposit" && (
                                            <View style={styles.cardBody}>
                                                <Text style={styles.cardSubtitle}>
                                                    Choose a method, complete payment, then paste your reference ID.
                                                </Text>

                                                <InlineError message={depositMethodError} />
                                                <View style={styles.methodGrid}>
                                                    {PAYMENT_METHODS.map((m) => (
                                                        <TouchableOpacity
                                                            key={m.key}
                                                            style={[styles.methodCard, depositMethod === m.key && styles.methodCardActive]}
                                                            onPress={() => {
                                                                setDepositMethod(m.key);
                                                                setDepositMethodError("");
                                                            }}
                                                            activeOpacity={0.7}
                                                        >
                                                            <Ionicons
                                                                name={m.icon as any}
                                                                size={18}
                                                                color={depositMethod === m.key ? "#ff7f2a" : "#6b7280"}
                                                            />
                                                            <Text style={[styles.methodLabel, depositMethod === m.key && styles.methodLabelActive]}>
                                                                {m.label}
                                                            </Text>
                                                        </TouchableOpacity>
                                                    ))}
                                                </View>
                                                {depositMethod && (
                                                    <View style={styles.destCard}>
                                                        <Text style={styles.destLabel}>Send payment to:</Text>
                                                        <Text style={styles.destValue} selectable>
                                                            {PAYMENT_METHODS.find((m) => m.key === depositMethod)?.dest}
                                                        </Text>
                                                    </View>
                                                )}

                                                <Text style={styles.fieldLabel}>Amount (GHS)</Text>
                                                <InlineError message={depositAmountError} />
                                                <TextInput
                                                    style={[styles.inputField, Platform.OS === "web" && (styles.webInput as any)]}
                                                    value={depositAmount}
                                                    onChangeText={(v) => {
                                                        setDepositAmount(v);
                                                        setDepositAmountError("");
                                                    }}
                                                    keyboardType="decimal-pad"
                                                    placeholder="e.g. 50"
                                                    maxLength={6}
                                                />

                                                <Text style={styles.fieldLabel}>Transaction / Reference ID</Text>
                                                <InlineError message={depositTxIdError} />
                                                <TextInput
                                                    style={[styles.inputField, { minHeight: 55 }, Platform.OS === "web" && (styles.webInput as any)]}
                                                    value={depositTxId}
                                                    onChangeText={(v) => {
                                                        setDepositTxId(v);
                                                        setDepositTxIdError("");
                                                    }}
                                                    placeholder="Paste your payment reference here"
                                                    multiline
                                                    maxLength={20}
                                                />
                                                {depositStatus === "success" && (
                                                    <View style={styles.successBanner}>
                                                        <Ionicons name="checkmark-circle" size={18} color="#16a34a" />
                                                        <Text style={styles.successText}>
                                                            Deposit submitted! Awaiting admin confirmation.
                                                        </Text>
                                                    </View>
                                                )}
                                                {depositStatus === "failed" && (
                                                    <View style={styles.errorBanner}>
                                                        <Ionicons name="close-circle" size={18} color="#dc2626" />
                                                        <Text style={styles.errorText}>Submission failed. Please try again.</Text>
                                                    </View>
                                                )}
                                                <TouchableOpacity
                                                    style={[styles.actionBtn, depositStatus === "submitting" && styles.actionBtnDisabled]}
                                                    onPress={handleDeposit}
                                                    disabled={depositStatus === "submitting"}
                                                    activeOpacity={0.8}
                                                >
                                                    {depositStatus === "submitting"
                                                        ? <ActivityIndicator color="#fff" size="small" />
                                                        : <Text style={styles.actionBtnText}>Submit Deposit</Text>
                                                    }
                                                </TouchableOpacity>
                                            </View>
                                        )}
                                    </View>
                                </Pressable>

                                {/* ════ WITHDRAWAL ════ */}
                                <Pressable onPress={() => { setShowDropdown(false); setShowCountryPicker(false); }}>
                                    <View style={styles.card}>
                                        <TouchableOpacity
                                            style={styles.cardHeader}
                                            onPress={() => setActiveCard(activeCard === "withdraw" ? "wallet" : "withdraw")}
                                            activeOpacity={0.7}
                                        >
                                            <Ionicons name="hourglass-sharp" size={18} color="#444" />
                                            <Text style={styles.cardHeaderText}>
                                                Withdrawal{" "}
                                                <Text style={{ color: "#f0ad02", fontWeight: "800" }}>
                                                    (Bal: GHS {formatGHS(walletBalance)})
                                                </Text>
                                            </Text>
                                            <Ionicons
                                                name={activeCard === "withdraw" ? "chevron-up" : "chevron-down"}
                                                size={18} color="#888" style={{ marginLeft: "auto" }}
                                            />
                                        </TouchableOpacity>

                                        {activeCard === "withdraw" && (
                                            <View style={styles.cardBody}>

                                                <Text style={styles.fieldLabel}>Receiving Country</Text>
                                                <TouchableOpacity
                                                    style={styles.countryPickerBtn}
                                                    onPress={() => setShowCountryPicker((v) => !v)}
                                                    activeOpacity={0.8}
                                                >
                                                    <Text style={styles.countryFlag}>{withdrawCountry.flag}</Text>
                                                    <View style={{ flex: 1 }}>
                                                        <Text style={styles.countryName}>{withdrawCountry.name}</Text>
                                                        <Text style={styles.countryMeta}>{withdrawCountry.dialCode} · {withdrawCountry.currency}</Text>
                                                    </View>
                                                    <Ionicons name={showCountryPicker ? "chevron-up" : "chevron-down"} size={16} color="#888" />
                                                </TouchableOpacity>

                                                {showCountryPicker && (
                                                    <View style={styles.countryList}>
                                                        <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" style={{ maxHeight: 220 }}>
                                                            {WITHDRAW_COUNTRIES.map((c) => (
                                                                <TouchableOpacity
                                                                    key={c.code}
                                                                    style={[
                                                                        styles.countryListItem,
                                                                        withdrawCountry.code === c.code && styles.countryListItemActive,
                                                                    ]}
                                                                    onPress={() => {
                                                                        setWithdrawCountry(c);
                                                                        setWithdrawMethod(null);
                                                                        setWithdrawOperator("");
                                                                        setWithdrawAccountInfo("");
                                                                        setWithdrawMethodError("");
                                                                        setWithdrawAmountError("");
                                                                        setWithdrawAccountError("");
                                                                        setWithdrawOperatorError("");
                                                                        setShowCountryPicker(false);
                                                                    }}
                                                                >
                                                                    <Text style={styles.countryFlag}>{c.flag}</Text>
                                                                    <Text style={[
                                                                        styles.countryListName,
                                                                        withdrawCountry.code === c.code && styles.countryListNameActive,
                                                                    ]}>
                                                                        {c.name}
                                                                    </Text>
                                                                    <Text style={styles.countryListMeta}>{c.dialCode} · {c.currency}</Text>
                                                                </TouchableOpacity>
                                                            ))}
                                                        </ScrollView>
                                                    </View>
                                                )}

                                                <Text style={styles.fieldLabel}>Payout Method</Text>
                                                <InlineError message={withdrawMethodError} />
                                                <View style={styles.methodGrid}>
                                                    {withdrawCountry.methods.map((key) => {
                                                        const cfg = WITHDRAW_METHOD_CONFIGS[key];
                                                        return (
                                                            <TouchableOpacity
                                                                key={key}
                                                                style={[styles.methodCard, withdrawMethod === key && styles.methodCardActive]}
                                                                onPress={() => {
                                                                    setWithdrawMethod(key);
                                                                    setWithdrawOperator("");
                                                                    setWithdrawAccountInfo("");
                                                                    setWithdrawMethodError("");
                                                                    setWithdrawOperatorError("");
                                                                    setWithdrawAccountError("");
                                                                }}
                                                                activeOpacity={0.7}
                                                            >
                                                                <Ionicons
                                                                    name={cfg.icon}
                                                                    size={18}
                                                                    color={withdrawMethod === key ? "#ff7f2a" : "#6b7280"}
                                                                />
                                                                <Text style={[
                                                                    styles.methodLabel,
                                                                    withdrawMethod === key && styles.methodLabelActive,
                                                                ]}>
                                                                    {cfg.label}
                                                                </Text>
                                                            </TouchableOpacity>
                                                        );
                                                    })}
                                                </View>

                                                {withdrawMethod && (() => {
                                                    const cfg = WITHDRAW_METHOD_CONFIGS[withdrawMethod];
                                                    return (
                                                        <View style={styles.limitBadge}>
                                                            <Ionicons name="information-circle-outline" size={14} color="#2563eb" />
                                                            <Text style={styles.limitBadgeText}>
                                                                Limit: GHS {formatGHS(cfg.minGHS)} – GHS {formatGHS(cfg.maxGHS)}
                                                                {"  "}·{"  "}
                                                                Fee: {(cfg.feePercent * 100).toFixed(1)}%{cfg.feeFlat > 0 ? ` + GHS ${formatGHS(cfg.feeFlat)}` : ""}
                                                            </Text>
                                                        </View>
                                                    );
                                                })()}

                                                {withdrawMethod && WITHDRAW_METHOD_CONFIGS[withdrawMethod].hasOperator && (
                                                    (() => {
                                                        const operators = withdrawCountry.operators[withdrawMethod] ?? [];
                                                        return operators.length > 0 ? (
                                                            <>
                                                                <Text style={styles.fieldLabel}>
                                                                    {withdrawMethod === "bank" ? "Bank" : "Network Operator"}
                                                                </Text>
                                                                <InlineError message={withdrawOperatorError} />
                                                                <View style={styles.operatorGrid}>
                                                                    {operators.map((op) => (
                                                                        <TouchableOpacity
                                                                            key={op}
                                                                            style={[
                                                                                styles.operatorChip,
                                                                                withdrawOperator === op && styles.operatorChipActive,
                                                                            ]}
                                                                            onPress={() => {
                                                                                setWithdrawOperator(op);
                                                                                setWithdrawOperatorError("");
                                                                            }}
                                                                            activeOpacity={0.7}
                                                                        >
                                                                            <Text style={[
                                                                                styles.operatorChipText,
                                                                                withdrawOperator === op && styles.operatorChipTextActive,
                                                                            ]}>
                                                                                {op}
                                                                            </Text>
                                                                        </TouchableOpacity>
                                                                    ))}
                                                                </View>
                                                            </>
                                                        ) : null;
                                                    })()
                                                )}

                                                {withdrawMethod && (
                                                    <>
                                                        <Text style={styles.fieldLabel}>
                                                            {WITHDRAW_METHOD_CONFIGS[withdrawMethod].accountLabel}
                                                            {(withdrawMethod === "momo") && (
                                                                <Text style={{ color: "#9ca3af", fontWeight: "400" }}>
                                                                    {" "}({withdrawCountry.dialCode})
                                                                </Text>
                                                            )}
                                                        </Text>
                                                        <InlineError message={withdrawAccountError} />
                                                        <TextInput
                                                            style={[styles.inputField, Platform.OS === "web" && (styles.webInput as any)]}
                                                            value={withdrawAccountInfo}
                                                            onChangeText={(v) => {
                                                                setWithdrawAccountInfo(v);
                                                                setWithdrawAccountError("");
                                                            }}
                                                            keyboardType={WITHDRAW_METHOD_CONFIGS[withdrawMethod].keyboardType}
                                                            autoCapitalize="none"
                                                            placeholder={WITHDRAW_METHOD_CONFIGS[withdrawMethod].accountPlaceholder}
                                                            placeholderTextColor="#9ca3af"
                                                            maxLength={15}
                                                        />
                                                        {withdrawAccountInfo.trim().length > 3 && (
                                                            <View style={styles.destCard}>
                                                                <Text style={styles.destLabel}>
                                                                    {withdrawCountry.flag} Funds destination:
                                                                </Text>
                                                                <Text style={styles.destValue} selectable>
                                                                    {withdrawOperator ? `${withdrawOperator} · ` : ""}
                                                                    {withdrawCountry.dialCode && withdrawMethod === "momo"
                                                                        ? `${withdrawCountry.dialCode} ${withdrawAccountInfo.trim()}`
                                                                        : withdrawAccountInfo.trim()}
                                                                </Text>
                                                            </View>
                                                        )}
                                                    </>
                                                )}

                                                {withdrawMethod && (
                                                    <>
                                                        <Text style={styles.fieldLabel}>Amount (GHS)</Text>
                                                        <InlineError message={withdrawAmountError} />
                                                        <View style={styles.withdrawRow}>
                                                            <View style={{ flex: 1 }}>
                                                                {withdrawStatus === "submitting" ? (
                                                                    <View style={styles.withdrawWaiting}>
                                                                        <ActivityIndicator size="small" color="#2ca806" />
                                                                        <Text style={{ color: "#2ca806", fontWeight: "700", marginLeft: 8 }}>
                                                                            Processing…
                                                                        </Text>
                                                                    </View>
                                                                ) : (
                                                                    <TextInput
                                                                        style={[
                                                                            styles.inputField,
                                                                            { textAlign: "center" },
                                                                            Platform.OS === "web" && (styles.webInput as any),
                                                                        ]}
                                                                        value={withdrawAmount}
                                                                        onChangeText={(v) => {
                                                                            setWithdrawAmount(v);
                                                                            setWithdrawAmountError("");
                                                                        }}
                                                                        keyboardType="decimal-pad"
                                                                        maxLength={10}
                                                                        placeholder="0.00"
                                                                        placeholderTextColor="#9ca3af"
                                                                    />
                                                                )}
                                                            </View>
                                                            <TouchableOpacity
                                                                style={[
                                                                    styles.withdrawBtn,
                                                                    (!withdrawAmount
                                                                        || !withdrawMethod
                                                                        || !withdrawAccountInfo.trim()
                                                                        || (WITHDRAW_METHOD_CONFIGS[withdrawMethod].hasOperator && !withdrawOperator)
                                                                        || Number(withdrawAmount) < WITHDRAW_METHOD_CONFIGS[withdrawMethod].minGHS
                                                                        || Number(withdrawAmount) > walletBalance
                                                                        || withdrawStatus === "submitting"
                                                                    ) && styles.withdrawBtnDisabled,
                                                                ]}
                                                                onPress={handleWithdraw}
                                                                disabled={
                                                                    !withdrawAmount
                                                                    || !withdrawMethod
                                                                    || !withdrawAccountInfo.trim()
                                                                    || (WITHDRAW_METHOD_CONFIGS[withdrawMethod].hasOperator && !withdrawOperator)
                                                                    || Number(withdrawAmount) < WITHDRAW_METHOD_CONFIGS[withdrawMethod].minGHS
                                                                    || Number(withdrawAmount) > walletBalance
                                                                    || withdrawStatus === "submitting"
                                                                }
                                                            >
                                                                <Text style={styles.withdrawBtnText}>Withdraw</Text>
                                                            </TouchableOpacity>
                                                        </View>

                                                        {Number(withdrawAmount) >= WITHDRAW_METHOD_CONFIGS[withdrawMethod].minGHS && (
                                                            (() => {
                                                                const { fee, net } = calcWithdrawFee(Number(withdrawAmount), withdrawMethod);
                                                                return (
                                                                    <View style={styles.feePreviewCard}>
                                                                        <View style={styles.feeRow}>
                                                                            <Text style={styles.feeLabel}>Amount</Text>
                                                                            <Text style={styles.feeValue}>GHS {formatGHS(Number(withdrawAmount))}</Text>
                                                                        </View>
                                                                        <View style={styles.feeRow}>
                                                                            <Text style={styles.feeLabel}>Processing fee</Text>
                                                                            <Text style={[styles.feeValue, { color: "#dc2626" }]}>− GHS {formatGHS(fee)}</Text>
                                                                        </View>
                                                                        <View style={[styles.feeRow, styles.feeRowTotal]}>
                                                                            <Text style={styles.feeLabelTotal}>You receive</Text>
                                                                            <Text style={styles.feeValueTotal}>GHS {formatGHS(net)}</Text>
                                                                        </View>
                                                                    </View>
                                                                );
                                                            })()
                                                        )}
                                                    </>
                                                )}

                                                {(withdrawStatus === "success" || withdrawStatus === "failed") && (
                                                    <View style={withdrawStatus === "success" ? styles.successBanner : styles.errorBanner}>
                                                        <Ionicons
                                                            name={withdrawStatus === "success" ? "checkmark-circle" : "close-circle"}
                                                            size={18}
                                                            color={withdrawStatus === "success" ? "#16a34a" : "#dc2626"}
                                                        />
                                                        <Text style={withdrawStatus === "success" ? styles.successText : styles.errorText}>
                                                            {withdrawMessage}
                                                        </Text>
                                                    </View>
                                                )}

                                                <View style={styles.withdrawStatusRow}>
                                                    <Text style={[styles.withdrawStatusText, { color: getWithdrawStatusColor() }]}>
                                                        {getWithdrawStatusLabel()}
                                                    </Text>
                                                </View>
                                            </View>
                                        )}
                                    </View>
                                </Pressable>

                                {/* ════ P2P ════ */}
                                <Pressable onPress={() => setShowDropdown(false)}>
                                    <View style={styles.card}>
                                        <TouchableOpacity
                                            style={styles.cardHeader}
                                            onPress={() => setActiveCard(activeCard === "p2p" ? "wallet" : "p2p")}
                                            activeOpacity={0.7}
                                        >
                                            <Ionicons name="swap-horizontal-outline" size={18} color="#444" />
                                            <Text style={styles.cardHeaderText}>P2P Transfer</Text>
                                            <Ionicons
                                                name={activeCard === "p2p" ? "chevron-up" : "chevron-down"}
                                                size={18} color="#888" style={{ marginLeft: "auto" }}
                                            />
                                        </TouchableOpacity>
                                        {activeCard === "p2p" && (
                                            <View style={styles.cardBody}>
                                                <Text style={styles.cardSubtitle}>
                                                    Send funds instantly to any user. Zero fees. Balance:{" "}
                                                    <Text style={{ fontWeight: "700" }}>GHS {formatGHS(walletBalance)}</Text>
                                                </Text>

                                                <Text style={styles.fieldLabel}>Recipient Email</Text>
                                                <InlineError message={recipientError} />
                                                <View style={styles.lookupRow}>
                                                    <TextInput
                                                        style={[styles.inputField, { flex: 1, marginRight: 8 }, Platform.OS === "web" && (styles.webInput as any)]}
                                                        value={p2pRecipientEmail}
                                                        onChangeText={(v) => {
                                                            setP2pRecipientEmail(v);
                                                            setP2pRecipientData(null);
                                                            setRecipientError("");
                                                        }}
                                                        keyboardType="email-address"
                                                        autoCapitalize="none"
                                                        placeholder="user@example.com"
                                                    />
                                                    <TouchableOpacity
                                                        style={styles.lookupBtn}
                                                        onPress={handleLookupRecipient}
                                                        disabled={lookingUpRecipient}
                                                    >
                                                        {lookingUpRecipient
                                                            ? <ActivityIndicator color="#fff" size="small" />
                                                            : <Text style={styles.lookupBtnText}>Find</Text>
                                                        }
                                                    </TouchableOpacity>
                                                </View>
                                                {p2pRecipientData && (
                                                    <View style={styles.recipientCard}>
                                                        <Ionicons name="person-circle-outline" size={28} color="#2563eb" />
                                                        <View style={{ marginLeft: 10 }}>
                                                            <Text style={styles.recipientName}>
                                                                {p2pRecipientData.clientName ?? p2pRecipientEmail}
                                                            </Text>
                                                            <Text style={styles.recipientEmail}>{p2pRecipientEmail}</Text>
                                                        </View>
                                                        <View style={styles.recipientBadge}>
                                                            <Text style={styles.recipientBadgeText}>✓ Found</Text>
                                                        </View>
                                                    </View>
                                                )}

                                                <InlineError message={p2pSenderError} />

                                                <Text style={styles.fieldLabel}>Amount (GHS)</Text>
                                                <InlineError message={p2pAmountError} />
                                                <TextInput
                                                    style={[styles.inputField, Platform.OS === "web" && (styles.webInput as any)]}
                                                    value={p2pAmount}
                                                    onChangeText={(v) => {
                                                        setP2pAmount(v);
                                                        setP2pAmountError("");
                                                    }}
                                                    keyboardType="decimal-pad"
                                                    placeholder="e.g. 10.00"
                                                />
                                                {p2pStatus === "success" && (
                                                    <View style={styles.successBanner}>
                                                        <Ionicons name="checkmark-circle" size={18} color="#16a34a" />
                                                        <Text style={styles.successText}>✅ Transfer completed successfully!</Text>
                                                    </View>
                                                )}
                                                {!!p2pError && (
                                                    <View style={styles.errorBanner}>
                                                        <Ionicons name="close-circle" size={18} color="#dc2626" />
                                                        <Text style={styles.errorText}>{p2pError}</Text>
                                                    </View>
                                                )}
                                                <TouchableOpacity
                                                    style={[
                                                        styles.actionBtn,
                                                        { backgroundColor: "#2563eb" },
                                                        (p2pStatus === "submitting" || !p2pRecipientData) && styles.actionBtnDisabled,
                                                    ]}
                                                    onPress={handleP2PTransfer}
                                                    disabled={p2pStatus === "submitting" || !p2pRecipientData}
                                                    activeOpacity={0.8}
                                                >
                                                    {p2pStatus === "submitting"
                                                        ? <ActivityIndicator color="#fff" size="small" />
                                                        : <Text style={styles.actionBtnText}>Send Transfer</Text>
                                                    }
                                                </TouchableOpacity>
                                            </View>
                                        )}
                                    </View>
                                </Pressable>

                                {/* ════ TRANSACTION HISTORY ════ */}
                                <Pressable onPress={() => setShowDropdown(false)}>
                                    <View style={styles.card}>
                                        <TouchableOpacity
                                            style={styles.cardHeader}
                                            onPress={() => setActiveCard("wallet")}
                                            activeOpacity={0.7}
                                        >
                                            <Ionicons name="trail-sign-sharp" size={18} color="#444" />
                                            <Text style={styles.cardHeaderText}>
                                                Transaction History
                                                {pendingCount > 0 && (
                                                    <Text style={{ color: "#d97706" }}>{"  "}({pendingCount} pending)</Text>
                                                )}
                                            </Text>
                                            <Ionicons
                                                name={activeCard === "history" ? "chevron-up" : "chevron-down"}
                                                size={18} color="#888" style={{ marginLeft: "auto" }}
                                            />
                                        </TouchableOpacity>

                                        <View style={styles.cardBody}>
                                            {pendingTransactions.length === 0 ? (
                                                <View style={styles.emptyState}>
                                                    <Ionicons name="checkmark-circle-outline" size={34} color="#16a34a" />
                                                    <Text style={[styles.emptyText, { color: "#16a34a" }]}>No pending transactions.</Text>
                                                </View>
                                            ) : (
                                                <>
                                                    <View style={styles.pendingSectionHeader}>
                                                        <Ionicons name="time-outline" size={14} color="#d97706" />
                                                        <Text style={styles.pendingSectionTitle}>
                                                            Awaiting Approval ({pendingTransactions.length})
                                                        </Text>
                                                    </View>
                                                    {pendingTransactions.map((tx) => (
                                                        <TxCard key={tx.id} tx={tx} />
                                                    ))}
                                                </>
                                            )}

                                            {pagedTransactions.length > 0 && (
                                                <View style={{ marginTop: 8 }}>
                                                    {hasMore ? (
                                                        <TouchableOpacity
                                                            style={styles.viewAllBtn}
                                                            onPress={loadMore}
                                                            disabled={loadingPage}
                                                            activeOpacity={0.8}
                                                        >
                                                            {loadingPage
                                                                ? <ActivityIndicator color="#fff" size="small" />
                                                                : <Text style={styles.viewAllBtnText}>Load more</Text>
                                                            }
                                                        </TouchableOpacity>
                                                    ) : (
                                                        <Text style={[styles.emptyText, { textAlign: "center", marginTop: 4 }]}>
                                                            — All transactions loaded —
                                                        </Text>
                                                    )}
                                                </View>
                                            )}
                                        </View>
                                    </View>
                                </Pressable>

                                {/* ════ SEASON ════ */}
                                <Pressable onPress={() => setShowDropdown(false)}>
                                    <View style={styles.card}>
                                        <View style={styles.cardHeader}>
                                            <Ionicons name="shapes" size={18} color="#444" />
                                            <Text style={styles.cardHeaderText}>Earn as you learn...</Text>
                                        </View>
                                    </View>
                                </Pressable>
                            </ScrollView>
                        </View>
                    </View>
                </View>
            </SafeAreaView>
        </ReusableScreen>
    );
}

// ─── TxCard ───────────────────────────────────────────────────────────────────
function TxCard({ tx }: { tx: WalletTx }) {
    const displayAmt = resolveDisplayAmount(tx);
    const label = txLabel(tx);
    const icon = txIcon(tx);
    const amountColor = txAmountColor(tx);
    const prefix = txAmountPrefix(tx);

    const dateDisplay = (() => {
        const ca = tx.createdAt;
        if (!ca) return "—";
        if (typeof ca.toDate === "function") {
            return getTimeAgo(ca.toDate().toISOString());
        }
        if (typeof ca === "string") {
            return getTimeAgo(ca);
        }
        return "—";
    })();

    return (
        <View style={[styles.txCard, styles.txCardPending]}>
            <View style={styles.txIconWrap}>
                <Ionicons name={icon} size={20} color="#ff7f2a" />
            </View>
            <View style={styles.txInfo}>
                <Text style={styles.txType}>{label}</Text>
                {tx.note ? (
                    <Text style={styles.txNote} numberOfLines={1}>{tx.note}</Text>
                ) : null}
                <Text style={styles.txDate}>{dateDisplay}</Text>
            </View>
            <View style={styles.txRight}>
                <Text style={[styles.txAmount, { color: amountColor }]}>
                    {prefix}GHS {formatGHS(displayAmt)}
                </Text>
                <View style={[styles.txStatusBadge, { borderColor: "#d97706" }]}>
                    <Text style={[styles.txStatusText, { color: "#d97706" }]}>Pending</Text>
                </View>
            </View>
        </View>
    );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const ACCENT = "#ff7f2a";

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: "#fff", alignItems: "center" },
    loaderContainer: {
        position: "absolute", left: 0, top: "15%", bottom: 0, right: 0,
        zIndex: 200, alignItems: "center",
    },
    cardTop: { width: "100%", backgroundColor: "#fff", padding: 5 },
    scrollArea: { backgroundColor: "#eeeeee97", paddingHorizontal: 8, paddingBottom: 10 },
    scrollContent: { paddingTop: 8, paddingBottom: 60, gap: 8 },

    headerRow: {
        paddingLeft: 15, paddingRight: 0, paddingVertical: 10, marginBottom: 8,
        borderBottomWidth: 1, borderBottomColor: "#eee",
        flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    },
    headerLeft: { flexDirection: "row", alignItems: "center", gap: 5 },
    profileName: { fontSize: 20, fontWeight: "700", color: "#222" },
    refreshButton: { backgroundColor: "#f8ab05", paddingHorizontal: 12, paddingVertical: 5, borderRadius: 30 },
    refreshButtonText: { color: "#fff", fontWeight: "600", fontSize: 12 },

    profileRow: { flexDirection: "row", marginBottom: 5, alignItems: "flex-start", paddingHorizontal: 10 },
    profileLeft: { flexDirection: "row", alignItems: "flex-start", gap: 0, flex: 1 },
    avatar: { width: 55, height: 55, borderRadius: 32, marginRight: 14 },
    profileMeta: { fontSize: 16, color: "#888", marginVertical: 2 },
    contactRow: { flexDirection: "row", alignItems: "center" },
    contactText: { fontSize: 16, color: "#555", marginLeft: 6 },

    webInput: { outlineStyle: "none", outlineWidth: 0, boxShadow: "none" } as any,

    pendingBadgeRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
    pendingBadgeText: { fontSize: 13, color: "#d97706", fontWeight: "600" },

    personalToggle: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 4 },
    personalToggleText: { fontSize: 16, color: "#6b7280", fontWeight: "500" },
    viewAllTransactionsText: { fontSize: 16, color: "#ff7b00ff", fontWeight: "500" },
    personalPanel: {
        marginTop: 8, backgroundColor: "#f9fafb", borderRadius: 10,
        borderWidth: 1, borderColor: "#e5e7eb", padding: 10, gap: 5,
    },
    pdRow: { flexDirection: "row", alignItems: "center", paddingVertical: 3, gap: 6 },
    pdLabel: { fontSize: 11, color: "#9ca3af", width: 58, fontWeight: "500" },
    pdValue: { fontSize: 13, color: "#111827", fontWeight: "600", flex: 1, textTransform: "capitalize" },
    pdSaved: { fontSize: 11, color: "#16a34a", fontWeight: "600", marginTop: 2 },
    pdEditBtn: {
        flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start",
        backgroundColor: "#e8f1ff", paddingHorizontal: 10, paddingVertical: 4,
        borderRadius: 8, marginTop: 4,
    },
    pdEditBtnText: { fontSize: 12, color: "#1f6feb", fontWeight: "600" },
    pdFieldLabel: {
        fontSize: 11, fontWeight: "600", color: "#6b7280",
        textTransform: "uppercase", letterSpacing: 0.4, marginTop: 4,
    },
    pdInput: {
        borderWidth: 1, borderColor: "#d1d5db", borderRadius: 7,
        paddingHorizontal: 10, paddingVertical: 7, fontSize: 13,
        color: "#111827", backgroundColor: "#fff",
    },
    pdDobRow: { flexDirection: "row", alignItems: "center", gap: 4 },
    pdDobInput: {
        borderWidth: 1, borderColor: "#d1d5db", borderRadius: 7, width: 44,
        paddingVertical: 7, textAlign: "center", fontSize: 13, color: "#111827", backgroundColor: "#fff",
    },
    pdDobInputYear: {
        borderWidth: 1, borderColor: "#d1d5db", borderRadius: 7, width: 58,
        paddingVertical: 7, textAlign: "center", fontSize: 13, color: "#111827", backgroundColor: "#fff",
    },
    pdDobSep: { fontSize: 16, color: "#9ca3af" },
    pdGenderRow: { flexDirection: "row", flexWrap: "wrap", gap: 5 },
    pdGenderChip: {
        borderWidth: 1, borderColor: "#d1d5db", borderRadius: 20,
        paddingHorizontal: 9, paddingVertical: 3, backgroundColor: "#fff",
    },
    pdGenderChipActive: { borderColor: "#1A73E8", backgroundColor: "#e8f0fe" },
    pdGenderChipText: { fontSize: 11, color: "#6b7280", fontWeight: "500" },
    pdGenderChipTextActive: { color: "#1A73E8", fontWeight: "700" },
    pdSaveRow: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 4 },
    pdCancelBtn: {
        paddingHorizontal: 12, paddingVertical: 5, borderRadius: 8,
        borderWidth: 1, borderColor: "#d1d5db",
    },
    pdCancelText: { fontSize: 12, color: "#6b7280", fontWeight: "600" },
    pdSaveBtn: { backgroundColor: "#1A73E8", paddingHorizontal: 16, paddingVertical: 5, borderRadius: 8 },
    pdSaveBtnDisabled: { opacity: 0.6 },
    pdSaveText: { fontSize: 12, color: "#fff", fontWeight: "700" },

    badgeBalanceStrip: {
        alignItems: "center", justifyContent: "space-between",
        borderWidth: 1, borderColor: "#62ec79", backgroundColor: "#cef1d4",
        marginHorizontal: 8, paddingVertical: 2, paddingRight: 4, paddingLeft: 2,
        flexDirection: "row", marginBottom: 10, marginTop: 10, borderRadius: 30,
    },
    badgeLeft: { flexDirection: "row", alignItems: "center" },
    badgePill: {
        borderWidth: 3, borderColor: "#bee9c7", backgroundColor: "#fff",
        paddingHorizontal: 12, paddingVertical: 4, borderRadius: 30,
    },
    badgePillText: { fontSize: 20, fontWeight: "800", color: "#02aa24" },
    pointsText: { color: "#000", marginLeft: 6, fontWeight: "800", fontSize: 20 },
    balanceRight: { flexDirection: "row", alignItems: "center" },
    balanceLabel: { fontSize: 18, fontWeight: "600", color: "#000" },
    balancePill: {
        alignItems: "center", borderWidth: 3, borderColor: "#aee9bb",
        backgroundColor: "#02aa24", paddingHorizontal: 12, paddingVertical: 5,
        borderRadius: 30, marginLeft: 4,
    },
    balancePillText: { fontSize: 24, fontWeight: "800", color: "#fff" },

    card: {
        backgroundColor: "#fff", borderRadius: 10, borderWidth: 2, borderColor: "#eaeaea",
        padding: 10, shadowColor: "#f1f1f1",
        shadowOffset: { width: 3, height: 3 }, shadowOpacity: 0.2, shadowRadius: 1,
    },
    cardHeader: {
        flexDirection: "row", gap: 10, paddingHorizontal: 8, paddingVertical: 8,
        borderRadius: 10, backgroundColor: "#fff", borderWidth: 1, borderColor: "#eee",
        alignItems: "center", marginBottom: 0,
    },
    cardHeaderText: { color: "#444", fontSize: 16, fontWeight: "800" },
    cardBody: { paddingTop: 12, gap: 12 },
    cardSubtitle: { fontSize: 13, color: "#6b7280", lineHeight: 18 },
    cardInfoRow: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
    cardInfoLabel: { fontWeight: "600", fontSize: 15 },
    cardInfoMono: { width: 200, fontSize: 14, color: "#000", fontWeight: "300" },

    cryptoBalRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
    currencyRow: { flexDirection: "row", alignItems: "center" },
    cryptoValue: { fontWeight: "300", fontSize: 15 },
    currencyWrapper: { flexDirection: "row", alignItems: "center", gap: 4 },
    currencyText: { fontWeight: "800", fontSize: 15 },

    methodGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    methodCard: {
        flexDirection: "row", alignItems: "center", gap: 6,
        borderWidth: 1.5, borderColor: "#e5e7eb", borderRadius: 10,
        paddingHorizontal: 12, paddingVertical: 8,
    },
    methodCardActive: { borderColor: ACCENT, backgroundColor: "#fff4ee" },
    methodLabel: { fontSize: 13, color: "#6b7280", fontWeight: "500" },
    methodLabelActive: { color: ACCENT, fontWeight: "700" },

    destCard: { backgroundColor: "#f9fafb", borderRadius: 10, padding: 12, borderWidth: 1, borderColor: "#e5e7eb" },
    destLabel: { fontSize: 12, color: "#9ca3af", marginBottom: 4 },
    destValue: { fontSize: 14, fontWeight: "600", color: "#111" },

    fieldLabel: { fontSize: 13, color: "#374151", fontWeight: "600" },
    inputField: {
        borderWidth: 1.5, borderColor: "#e5e7eb", borderRadius: 10,
        paddingHorizontal: 10, paddingVertical: 8, fontSize: 14,
        color: "#111", backgroundColor: "#fff",
    },

    actionBtn: { backgroundColor: ACCENT, borderRadius: 12, paddingVertical: 13, alignItems: "center" },
    actionBtnDisabled: { opacity: 0.5 },
    actionBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },

    successBanner: {
        flexDirection: "row", alignItems: "center", gap: 8,
        backgroundColor: "#f0fdf4", borderRadius: 10, padding: 12,
        borderWidth: 1, borderColor: "#bbf7d0",
    },
    successText: { color: "#15803d", fontSize: 13, flex: 1 },
    errorBanner: {
        flexDirection: "row", alignItems: "center", gap: 8,
        backgroundColor: "#fef2f2", borderRadius: 10, padding: 12,
        borderWidth: 1, borderColor: "#fecaca",
    },
    errorText: { color: "#dc2626", fontSize: 13, flex: 1 },

    withdrawRow: { flexDirection: "row", alignItems: "center", gap: 12 },
    withdrawWaiting: { flexDirection: "row", alignItems: "center", paddingVertical: 10 },
    withdrawBtn: { backgroundColor: ACCENT, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8 },
    withdrawBtnDisabled: { backgroundColor: "#ccc" },
    withdrawBtnText: { color: "#fff", fontWeight: "600", fontSize: 15 },
    withdrawStatusRow: { marginTop: 4 },
    withdrawStatusText: { fontWeight: "600", fontSize: 13 },

    lookupRow: { flexDirection: "row", alignItems: "center" },
    lookupBtn: {
        backgroundColor: "#2563eb", paddingHorizontal: 16, paddingVertical: 11,
        borderRadius: 10, minWidth: 60, alignItems: "center",
    },
    lookupBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
    recipientCard: {
        flexDirection: "row", alignItems: "center", backgroundColor: "#eff6ff",
        borderRadius: 10, padding: 12, borderWidth: 1, borderColor: "#bfdbfe",
    },
    recipientName: { fontSize: 14, fontWeight: "700", color: "#1e3a8a" },
    recipientEmail: { fontSize: 12, color: "#3b82f6" },
    recipientBadge: {
        marginLeft: "auto", backgroundColor: "#16a34a",
        borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4,
    },
    recipientBadgeText: { color: "#fff", fontSize: 12, fontWeight: "700" },

    viewAllBtn: {
        flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
        marginHorizontal: 50, backgroundColor: "#fba542ff",
        borderRadius: 50, paddingVertical: 8, paddingHorizontal: 6, marginBottom: 12,
    },
    viewAllBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },

    pendingSectionHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
    pendingSectionTitle: { fontSize: 13, fontWeight: "700", color: "#d97706" },

    txCard: {
        flexDirection: "row", alignItems: "center", backgroundColor: "#fafafa",
        borderRadius: 12, padding: 10, borderWidth: 1, borderColor: "#f0f0f0", gap: 10,
    },
    txCardPending: { borderColor: "#fde68a", backgroundColor: "#fffbeb" },
    txIconWrap: {
        width: 38, height: 38, borderRadius: 19, backgroundColor: "#fff4ee",
        alignItems: "center", justifyContent: "center",
    },
    txInfo: { flex: 1 },
    txType: { fontSize: 14, fontWeight: "600", color: "#111" },
    txNote: { fontSize: 12, color: "#9ca3af", marginTop: 2 },
    txDate: { fontSize: 11, color: "#d1d5db", marginTop: 3 },
    txRight: { alignItems: "flex-end", gap: 4 },
    txAmount: { fontSize: 13, fontWeight: "700" },
    txStatusBadge: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2 },
    txStatusText: { fontSize: 10, fontWeight: "600" },

    emptyState: { alignItems: "center", paddingVertical: 30, gap: 8 },
    emptyText: { color: "#9ca3af", fontSize: 14 },

    dropdown: {
        position: "absolute", top: "28%", left: "31%",
        backgroundColor: "#fff", borderRadius: 8, zIndex: 100,
        paddingLeft: 10, paddingVertical: 2,
        elevation: 6, shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 5,
    },
    columns: { flexDirection: "row" },
    column: { marginRight: 14 },
    dropdownItem: { paddingVertical: 6 },
    dropdownText: { fontSize: 14, fontWeight: "400" },

    countryPickerBtn: {
        flexDirection: "row", alignItems: "center", gap: 10,
        borderWidth: 1.5, borderColor: "#e5e7eb", borderRadius: 10,
        paddingHorizontal: 12, paddingVertical: 10, backgroundColor: "#fff",
    },
    countryFlag: { fontSize: 22 },
    countryName: { fontSize: 14, fontWeight: "600", color: "#111827" },
    countryMeta: { fontSize: 12, color: "#9ca3af" },
    countryList: {
        borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 10,
        backgroundColor: "#fff", overflow: "hidden",
    },
    countryListItem: {
        flexDirection: "row", alignItems: "center", gap: 10,
        paddingHorizontal: 12, paddingVertical: 10,
        borderBottomWidth: 1, borderBottomColor: "#f3f4f6",
    },
    countryListItemActive: { backgroundColor: "#fff4ee" },
    countryListName: { fontSize: 14, color: "#374151", fontWeight: "500", flex: 1 },
    countryListNameActive: { color: ACCENT, fontWeight: "700" },
    countryListMeta: { fontSize: 12, color: "#9ca3af" },
    limitBadge: {
        flexDirection: "row", alignItems: "center", gap: 6,
        backgroundColor: "#eff6ff", borderRadius: 8, padding: 8,
        borderWidth: 1, borderColor: "#bfdbfe",
    },
    limitBadgeText: { fontSize: 12, color: "#2563eb", flex: 1 },
    operatorGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    operatorChip: {
        borderWidth: 1.5, borderColor: "#e5e7eb", borderRadius: 20,
        paddingHorizontal: 12, paddingVertical: 6, backgroundColor: "#fff",
    },
    operatorChipActive: { borderColor: ACCENT, backgroundColor: "#fff4ee" },
    operatorChipText: { fontSize: 13, color: "#6b7280", fontWeight: "500" },
    operatorChipTextActive: { color: ACCENT, fontWeight: "700" },
    feePreviewCard: {
        backgroundColor: "#f9fafb", borderRadius: 10, padding: 12,
        borderWidth: 1, borderColor: "#e5e7eb", gap: 6,
    },
    feeRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    feeRowTotal: {
        borderTopWidth: 1, borderTopColor: "#e5e7eb",
        paddingTop: 6, marginTop: 2,
    },
    feeLabel: { fontSize: 13, color: "#6b7280" },
    feeValue: { fontSize: 13, fontWeight: "600", color: "#111827" },
    feeLabelTotal: { fontSize: 14, fontWeight: "700", color: "#111827" },
    feeValueTotal: { fontSize: 14, fontWeight: "800", color: "#16a34a" },
});
