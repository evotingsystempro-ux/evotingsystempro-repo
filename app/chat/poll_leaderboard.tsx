import React, { useContext, useEffect, useState, useCallback, useRef } from "react";
import {
    View,
    Text,
    TouchableOpacity,
    ScrollView,
    StyleSheet,
    ActivityIndicator,
    Alert,
    RefreshControl,
    Image,
    Platform,
    TextInput,
} from "react-native";
import { AntDesign, Ionicons, MaterialIcons } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import ReusableScreen from "@/components/ReusableScreen";
import { GlobalContext } from "@/context";
import { db } from "@/firebase";
import {
    doc, getDoc, setDoc, updateDoc,
    collection, onSnapshot, increment, serverTimestamp,
    query,
    where,
    runTransaction,
} from "firebase/firestore";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Aspirant {
    email: string;
    name: string;
    photo: string;
    votes: number;
    lastVotedAt: Date | null;
}

interface Poll {
    pollId: string;
    title: string;
    pollType: "single" | "multiple";
    requires_voters_validation: "true" | "false";
    poll_verification_status?: "verified" | "not_verified";   // ← NEW
    isAnonymous: boolean;
    showResults: boolean;
    deadline: string | null;
    status: "active" | "closed";
    creatorEmail: string;
    creatorName: string;
    aspirantCount: number;
    dateCreated: string;

}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const isExpired = (deadline: string | null) =>
    deadline ? new Date(deadline) < new Date() : false;

const totalVotes = (aspirants: Aspirant[]) =>
    aspirants.reduce((s, a) => s + (a.votes || 0), 0);

const formatDeadline = (deadline: string | null) => {
    if (!deadline) return null;
    return new Date(deadline).toLocaleString(undefined, {
        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
};

const RANK_LABELS = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th"];
const AVATAR_COLORS = ["#9d174d", "#1f2937", "#1F9F4E", "#2563eb", "#b45309", "#7c3aed"];

const timeAgo = (date: Date | null): string => {
    if (!date) return "no votes yet";
    const secs = Math.floor((Date.now() - date.getTime()) / 1000);
    if (secs < 10) return "now";
    if (secs < 60) return `${secs}s ago`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days === 1) return "yesterday";
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

// Count how many times this voter has voted for a given aspirant
// (used only for multiple-vote polls, where the same email can repeat)
const countFor = (emails: string[], email: string) =>
    emails.reduce((n, e) => (e === email ? n + 1 : n), 0);

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function PollLeaderboardScreen() {
    const { rawUserEmail, userid, userName } = useContext(GlobalContext);

    const params = useLocalSearchParams<{ pollId: string; creatorEmail: string }>();
    const pollId = Array.isArray(params.pollId) ? params.pollId[0] : params.pollId;
    const creatorEmail = Array.isArray(params.creatorEmail) ? params.creatorEmail[0] : params.creatorEmail;

    const [poll, setPoll] = useState<Poll | null>(null);
    const [aspirants, setAspirants] = useState<Aspirant[]>([]);
    const [loadingPoll, setLoadingPoll] = useState(true);
    const [loadingAspirants, setLoadingAspirants] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [votedAt, setVotedAt] = useState<Date | null>(null);

    const [lockedIndices, setLockedIndices] = useState<Set<number>>(new Set());

    // ── togglingEmail: state + ref so async guards never read stale values ─────
    const [togglingEmail, setTogglingEmail] = useState<string | null>(null);
    const togglingEmailRef = useRef<string | null>(null);
    const setTogglingEmailSafe = (val: string | null) => {
        togglingEmailRef.current = val;
        setTogglingEmail(val);
    };

    useFocusEffect(
        useCallback(() => {
            if (!userName) router.navigate("./PollsListScreen");
        }, [userName])
    );

    // ── votedEmails: state + ref so async handlers never read stale values ─────
    // For "single" polls this holds at most one email.
    // For "multiple" polls this holds ONE ENTRY PER VOTE CAST — duplicates
    // are expected and intentional (e.g. ["x@x.com","x@x.com","y@y.com"]
    // means 2 votes for x and 1 for y).
    const [votedEmails, setVotedEmails] = useState<string[]>([]);
    const votedEmailsRef = useRef<string[]>([]);
    const syncVotedEmails = useCallback((next: string[]) => {
        votedEmailsRef.current = next;
        setVotedEmails(next);
    }, []);

    // Tick every 5 s so timeAgo labels refresh automatically
    /*   const [, setTick] = useState(0);
      useEffect(() => {
          const id = setInterval(() => setTick(t => t + 1), 5_000);
          return () => clearInterval(id);
      }, []); */

    // ── Poll metadata (live) ──────────────────────────────────────────────────
    // POLL_TITLE_DB is now a flat top-level collection keyed by {pollId} —
    // creatorEmail/creatorName are denormalized fields on the doc, not path
    // segments, so we no longer need creatorEmail to build this path.

    useEffect(() => {
        if (!pollId) return;
        return onSnapshot(
            doc(db, "POLL_TITLE_DB", pollId),
            (snap) => {
                if (snap.exists()) setPoll(snap.data() as Poll);
                setLoadingPoll(false);
            },
            (err) => { console.error("poll listener:", err); setLoadingPoll(false); }
        );
    }, [pollId]);

    // ── Aspirants (live) ──────────────────────────────────────────────────────
    // ASPIRANTS_DETAILS_DB is now a flat top-level collection with composite
    // doc IDs ({pollId}_{aspirantEmail}), so we query by the pollId field
    // instead of reading a creatorEmail/pollId subcollection.

    useEffect(() => {
        if (!pollId) return;
        const aspirantsQuery = query(
            collection(db, "ASPIRANTS_DETAILS_DB"),
            where("pollId", "==", pollId)
        );
        return onSnapshot(
            aspirantsQuery,
            (snap) => {
                setAspirants(snap.docs.map(d => {
                    const data = d.data();
                    const raw = data.lastVotedAt;
                    return {
                        email: data.aspirantEmail ?? d.id,
                        name: data.name ?? d.id,
                        photo: data.photo ?? "",
                        votes: data.votes ?? 0,
                        lastVotedAt: raw?.toDate ? raw.toDate() : null,
                    };
                }));
                setLoadingAspirants(false);
                setRefreshing(false);
            },
            (err) => { console.error("aspirants listener:", err); setLoadingAspirants(false); }
        );
    }, [pollId]);

    // ── Load my existing vote(s) ──────────────────────────────────────────────
    // Path: VOTERS_DB/{pollId}_{voterEmail}   (flat, composite doc ID)

    const loadMyVotes = useCallback(async () => {
        if (!rawUserEmail || !pollId) return;
        try {
            const snap = await getDoc(doc(db, "VOTERS_DB", `${pollId}_${rawUserEmail}`));
            if (snap.exists()) {
                const data = snap.data();
                const voted = data?.aspirantVoted;
                const at = data?.votedAt;

                if (Array.isArray(voted)) {
                    syncVotedEmails(voted.filter(Boolean));
                } else if (voted) {
                    syncVotedEmails([voted]);
                } else {
                    syncVotedEmails([]);
                }

                setVotedAt(at?.toDate ? at.toDate() : null);
            } else {
                syncVotedEmails([]);
                setVotedAt(null);
            }
        } catch (e) {
            console.error("loadMyVotes:", e);
            syncVotedEmails([]);
            setVotedAt(null);
        }
    }, [rawUserEmail, pollId, syncVotedEmails]);

    useEffect(() => {
        loadMyVotes();
    }, [loadMyVotes]);




    // ------- VOTER VALIDATION ------
    // NOTE: VALIDATED_VOTERS_DB is a separate pre-approval list — distinct
    // from VOTERS_DB above, which records votes actually cast. Per the
    // updated schema it's a SINGLE doc per poll holding a flat array:
    //   VALIDATED_VOTERS_DB/{pollId} → { validCodes: string[] }
    // Every code in validCodes was lowercased & trimmed when the poll
    // creator saved it, so we match by doing the same normalization here.

    const sanitizeVoterCode = (raw: string) => raw.trim().toLowerCase();

    const checkVoterValidated = async (
        pollId: string,
        idOrEmail: string
    ): Promise<boolean> => {
        const trimmed = idOrEmail.trim();
        if (!pollId || !trimmed) return false;

        try {
            const snap = await getDoc(doc(db, "VALIDATED_VOTERS_DB", pollId));
            if (!snap.exists()) return false;

            const validCodes: string[] = snap.data()?.validCodes ?? [];
            return validCodes.includes(sanitizeVoterCode(trimmed));
        } catch (err) {
            console.error("checkVoterValidated:", err);
            return false;
        }
    };

    // const pollId = "POLL_1782998497301_A8AIA";
    //   const creatorEmail = "litmusberk@gmail.com";

    const [idOrEmail, setIdOrEmail] = useState(userid || rawUserEmail);
    const [wait_checking_voter_validation, setWait_checking_voter_validation]: any = useState("");

    const validateVoter = async (aspirantEmail: string, index: number) => {

        setLockedIndices(new Set());
        setWait_checking_voter_validation("Loading...");
        setLockedIndices(prev => new Set(prev).add(index));


        if (!pollId) {
            console.log("Missing pollId — cannot validate voter.");

            return;
        }

        if (!idOrEmail.trim()) return;
        try {
            const isVoterValidated = await checkVoterValidated(
                String(pollId),
                idOrEmail
            );

            handleToggleVote(aspirantEmail, index, isVoterValidated);

        } catch (err) {
            console.error("Voter validation check failed:", err);
        } finally {
            // setVoterValidation(false);
        }
    };

    // ── Toggle vote — SINGLE-VOTE POLLS ONLY (unchanged) ──────────────────────

    const handleToggleVote = async (aspirantEmail: string, index: number, isVoterValidated: boolean) => {
        if (!poll || !rawUserEmail || !pollId || !creatorEmail) {
            Alert.alert("Not ready", "Please wait a moment and try again.");
            return;
        }

        if (togglingEmailRef.current) return;

        if (poll.status === "closed" || isExpired(poll.deadline)) {
            Alert.alert("Poll closed", "This poll is no longer accepting votes.");
            return;
        }

        if (poll.requires_voters_validation === "true" && !isVoterValidated) {
            setLockedIndices(new Set());
            setWait_checking_voter_validation("You can't vote in this poll");
            setLockedIndices(prev => new Set(prev).add(index));
            return;
        }
        setWait_checking_voter_validation("");

        const current = votedEmailsRef.current;
        const hasVotedThis = current.includes(aspirantEmail);

        setTogglingEmailSafe(aspirantEmail);

        // ASPIRANTS_DETAILS_DB is flat — composite doc ID {pollId}_{email}
        const aspirantRef = (email: string) =>
            doc(db, "ASPIRANTS_DETAILS_DB", `${pollId}_${email}`);

        const voterDocRef = doc(db, "VOTERS_DB", `${pollId}_${rawUserEmail}`);

        try {
            if (hasVotedThis) {
                // ── Remove vote ───────────────────────────────────────────────
                await updateDoc(aspirantRef(aspirantEmail), {
                    votes: increment(-1),
                    lastVotedAt: serverTimestamp(),
                });

                const next = current.filter(e => e !== aspirantEmail);

                await setDoc(voterDocRef, {
                    pollId,
                    voterEmail: rawUserEmail,
                    votersName: userName || "Unknown",
                    pollTitle: poll.title,
                    creatorEmail,
                    aspirantVoted: next[0] ?? null,
                    votedAt: serverTimestamp(),
                }, { merge: true });

                setVotedAt(null);
                syncVotedEmails(next);

            } else {
                // ── Cast vote (swap if one already exists) ─────────────────────
                if (current.length > 0) {
                    await updateDoc(aspirantRef(current[0]), {
                        votes: increment(-1),
                        lastVotedAt: serverTimestamp(),
                    });
                }

                await updateDoc(aspirantRef(aspirantEmail), {
                    votes: increment(1),
                    lastVotedAt: serverTimestamp(),
                });

                const next = [aspirantEmail];

                await setDoc(voterDocRef, {
                    pollId,
                    voterEmail: rawUserEmail,
                    votersName: userName || "Unknown",
                    pollTitle: poll.title,
                    creatorEmail,
                    aspirantVoted: aspirantEmail,
                    votedAt: serverTimestamp(),
                }, { merge: true });

                setVotedAt(new Date());
                syncVotedEmails(next);
            }

        } catch (err: any) {
            console.error("handleToggleVote error:", err);
            Alert.alert("Vote failed", err?.message ?? "Could not update vote. Please try again.");
            await loadMyVotes();
        } finally {
            setTogglingEmailSafe(null);
        }
    };

    // ── Free removal — MULTIPLE-VOTE POLLS ONLY ───────────────────────────────
    // The "−" button removes one previously-cast vote from an aspirant, down
    // to a minimum of 0. This does NOT issue a refund — it only corrects the
    // voter's own tally. Adding votes is a PAID action, handled below.


    // ── Paid multi-vote — MULTIPLE-VOTE POLLS ONLY ────────────────────────────

    const VOTE_PRICE_GHS = 1.0;

    // Which aspirant's "enter quantity + pay" panel is currently open
    const [payingFor, setPayingFor] = useState<string | null>(null);
    const [voteQty, setVoteQty] = useState<string>("1");
    const [isPaying, setIsPaying] = useState(false);

    // ── Wallet-based charge ────────────────────────────────────────────────
    // Reads the voter's WALLET_DB/{voterEmail} doc and, only if
    // current_balance covers the cost, atomically deducts the balance AND
    // increments the aspirant's vote count in a single Firestore transaction
    // — so a balance can never be spent twice by two rapid taps, and votes
    // can never be added without the matching deduction succeeding.
    const chargeWalletAndVote = async (
        voterEmail: string,
        aspirantEmail: string,
        quantity: number,
        amountGHS: number
    ): Promise<{ success: boolean; reason?: "insufficient_funds" | "no_wallet" | "error" }> => {
        const walletRef = doc(db, "WALLET_DB", voterEmail);
        // ASPIRANTS_DETAILS_DB is flat — composite doc ID {pollId}_{aspirantEmail}
        const aspirantRef = doc(db, "ASPIRANTS_DETAILS_DB", `${pollId}_${aspirantEmail}`);

        try {
            await runTransaction(db, async (tx) => {
                const walletSnap = await tx.get(walletRef);

                if (!walletSnap.exists()) {
                    throw new Error("no_wallet");
                }

                const walletData = walletSnap.data() as any;
                const currentBalance =
                    typeof walletData.current_balance === "number" ? walletData.current_balance : 0;

                if (currentBalance < amountGHS) {
                    throw new Error("insufficient_funds");
                }

                const newBalance = currentBalance - amountGHS;

                tx.update(walletRef, {
                    previous_balance: currentBalance,
                    current_balance: newBalance,
                    transaction_amount: amountGHS,
                    transaction_type: "vote_payment",
                    updatedAt: serverTimestamp(),
                });

                tx.update(aspirantRef, {
                    votes: increment(quantity),
                    lastVotedAt: serverTimestamp(),
                });
            });

            return { success: true };

        } catch (err: any) {
            const reason =
                err?.message === "insufficient_funds" ? "insufficient_funds" :
                    err?.message === "no_wallet" ? "no_wallet" :
                        "error";

            if (reason === "error") console.error("chargeWalletAndVote error:", err);
            return { success: false, reason };
        }
    };

    const handlePayAndVote = async (aspirantEmail: string, index: number) => {

        setLockedIndices(new Set());
        setWait_checking_voter_validation("Loading...");
        setLockedIndices(prev => new Set(prev).add(index));

        if (!poll || !rawUserEmail || !pollId || !creatorEmail) {
            setWait_checking_voter_validation("Wait...");
            return;
        }

        if (poll.status === "closed" || isExpired(poll.deadline)) {
            setWait_checking_voter_validation("Poll closed...");
            return;
        }

        const quantity = parseInt(voteQty, 10);
        if (!Number.isInteger(quantity) || quantity < 1) {
            // Alert.alert("Invalid quantity", "Enter a whole number of votes (1 or more).");
            setWait_checking_voter_validation("Enter a whole number");
            return;
        }

        const amount = quantity * VOTE_PRICE_GHS;

        setIsPaying(true);
        setTogglingEmailSafe(aspirantEmail);

        try {
            const result = await chargeWalletAndVote(rawUserEmail, aspirantEmail, quantity, amount);

            if (!result.success) {
                if (result.reason === "insufficient_funds") {
                    /*  Alert.alert(
                         "Not enough funds",
                         `Your wallet balance is too low for GHS ${amount.toFixed(2)}. Please load your wallet and try again.`
                     ); */
                    setWait_checking_voter_validation("Insuficient balance");
                } else if (result.reason === "no_wallet") {
                    /*   Alert.alert(
                          "Wallet not found",
                          "You don't have a wallet set up yet. Please load your wallet and try again."
                      ); */
                    setWait_checking_voter_validation("Wallet not found");
                } else {
                    //   Alert.alert("Payment failed", "Your payment could not be processed. Please try again.");
                    setWait_checking_voter_validation("Payment failed");
                }
                return;
            }

            // Wallet deduction + vote increment already succeeded atomically —
            // now just record the receipt for this voter.
            const voterDocRef = doc(db, "VOTERS_DB", `${pollId}_${rawUserEmail}`);
            const current = votedEmailsRef.current;
            const next = [...current, ...Array(quantity).fill(aspirantEmail)];

            await setDoc(voterDocRef, {
                pollId,
                voterEmail: rawUserEmail,
                votersName: userName || "Unknown",
                pollTitle: poll.title,
                creatorEmail,
                aspirantVoted: next,
                votedAt: serverTimestamp(),
            }, { merge: true });

            syncVotedEmails(next);

            /*  Alert.alert(
                 "Vote completed",
                 `Payment of GHS ${amount.toFixed(2)} succeeded — ${quantity} vote${quantity !== 1 ? "s" : ""} cast.`
             ); */
            setWait_checking_voter_validation("");

            setPayingFor(null);
            setVoteQty("1");

        } catch (err: any) {
            console.error("handlePayAndVote error:", err);
            // Alert.alert("Payment failed", err?.message ?? "Could not process payment. Please try again.");
            setWait_checking_voter_validation("Cant process pay now..");
            await loadMyVotes();
        } finally {
            setIsPaying(false);
            setTogglingEmailSafe(null);
        }
    };

    const onRefresh = () => { setRefreshing(true); loadMyVotes(); };

    const sortedRef = useRef<Aspirant[]>([]);

    // ── Derived ─────────────────────────── ──── ─── ─── ───

    const alreadyVoted = votedEmails.length > 0;
    const expired = isExpired(poll?.deadline ?? null);
    const closed = poll?.status === "closed" || expired;
    const canVote = !closed;
    const total = totalVotes(aspirants);
    const myTotalVotesCast = votedEmails.length; // total votes this voter has cast across all aspirants
    const loading = loadingPoll || loadingAspirants;

    const sorted = (() => {
        if (togglingEmailRef.current) return sortedRef.current;
        const next = [...aspirants].sort((a, b) => (b.votes || 0) - (a.votes || 0));
        sortedRef.current = next;
        return next;
    })();

    // ── Loading ──────────────────────────────── ──── ─── ────

    if (loading) {

        return (
            <ReusableScreen>
                <View style={styles.header}>
                    <Text style={styles.headerTitle}>Leaderboard</Text>
                    <View style={{ width: 32 }} />
                </View>
                <View style={styles.centered}>
                    <ActivityIndicator size="large" color="#1F9F4E" />
                    <Text style={styles.loadingText}>Loading leaderboard…</Text>
                </View>
            </ReusableScreen>
        );
    }

    if (!poll) {
        return (
            <ReusableScreen>
                <View style={styles.centered}>
                    <Ionicons name="alert-circle-outline" size={48} color="#d1d5db" />
                    <Text style={styles.emptyText}>Poll not found.</Text>
                </View>
            </ReusableScreen>
        );
    }

    // ── Render ─────── <Text style={[styles.pollTitle, { flex: 1, }]} ellipsizeMode="tail" numberOfLines={2}> ───────────────

    return (
        <ReusableScreen>
            <View style={styles.topHeader}>
                <TouchableOpacity
                    onPress={() => router.navigate("./PollsListScreen")}
                    style={styles.backBtn}
                >
                    <Ionicons name="arrow-back" size={18} color="#fff" />
                </TouchableOpacity>

                <View style={styles.titleBlock}>
                    <Text style={styles.headerTitle} ellipsizeMode="tail" numberOfLines={1}>
                        {poll.title}
                    </Text>

                    <View style={styles.footerMeta}>
                        <Text style={styles.footerMetaText}> Creator: {poll.creatorName},</Text>

                        {poll.isAnonymous && (
                            <View style={styles.anonBadge}>
                                <Ionicons name="eye-off-outline" size={11} color="#6b7280" />
                                <Text style={styles.anonText}>Anonymous voting</Text>
                            </View>
                        )}

                        <View style={styles.pollTypeBadge}>
                            <Text style={styles.pollTypeBadgeText}>
                                {poll.pollType === "single" ? "Single-vote poll" : "Multiple-vote poll"}
                            </Text>
                        </View>
                    </View>
                </View>
            </View>

            {/* Status row */}
            <View style={styles.statusRow}>
                <View style={[styles.statusBadge, closed ? styles.badgeClosed : styles.badgeActive]}>
                    <View style={[styles.statusDot, closed ? styles.dotClosed : styles.dotActive]} />
                    <Text style={[styles.statusText, closed ? styles.statusTextClosed : styles.statusTextActive]}>
                        {closed ? (expired ? "Expired" : "Closed") : "Live"}
                    </Text>
                </View>

                {poll.requires_voters_validation === "true" ? (
                    <View style={{ paddingHorizontal: 9, paddingVertical: 3, borderRadius: 20, backgroundColor: "#EAF6EE", flexDirection: "row", alignItems: "center", gap: 4 }}>
                        <MaterialIcons name="verified" size={12} color="#3abf1fff" />
                        <Text style={{ color: "#299114ff", fontSize: 14, fontWeight: "500" }}>
                            VIP Voters only
                        </Text>
                    </View>
                ) : (
                    <View style={{ paddingHorizontal: 9, paddingVertical: 2, borderRadius: 20, backgroundColor: "#e4ece0ff", flexDirection: "row", alignItems: "center", gap: 4 }}>
                        <Ionicons name="globe-outline" size={12} color="#179a0bff" />
                        <Text style={{ color: "#217614ff", fontSize: 13, fontWeight: "600" }}>
                            Open to all
                        </Text>
                    </View>
                )}

                {poll.poll_verification_status === "verified" ? (
                    <View style={{ paddingHorizontal: 9, paddingVertical: 3, borderRadius: 20, backgroundColor: "#EAF6EE", flexDirection: "row", alignItems: "center", gap: 4 }}>
                        <MaterialIcons name="verified" size={12} color="#3abf1fff" />
                        <Text style={{ color: "#299114ff", fontSize: 14, fontWeight: "500" }}>
                            Verified Poll
                        </Text>
                    </View>
                ) : (
                    <View style={{ paddingHorizontal: 9, paddingVertical: 2, borderRadius: 20, backgroundColor: "#fee2e2", flexDirection: "row", alignItems: "center", gap: 4 }}>
                        <MaterialIcons name="cancel" size={12} color="#ef4444" />
                        <Text style={{ color: "#ef4444", fontSize: 12, fontWeight: "500" }}>
                            Unverified Poll
                        </Text>
                    </View>
                )}


                <View style={styles.metaChip}>
                    <MaterialIcons name="how-to-vote" size={18} color="#6b7280" />
                    <Text style={styles.metaChipText}>{total} vote{total !== 1 ? "s" : ""}</Text>
                </View>
                <View style={styles.metaChip}>
                    <Ionicons name="people-outline" size={18} color="#6b7280" />
                    <Text style={styles.metaChipText}>
                        {aspirants.length} aspirant{aspirants.length !== 1 ? "s" : ""}
                    </Text>
                </View>{/* 
                {poll.pollType === "multiple" && myTotalVotesCast > 0 && (
                    <View style={styles.metaChip}>
                        <Ionicons name="person-outline" size={14} color="#6b7280" />
                        <Text style={styles.metaChipText}>
                            You've cast {myTotalVotesCast} vote{myTotalVotesCast !== 1 ? "s" : ""}
                        </Text>
                    </View>
                )} */}
                {poll.deadline && (
                    <View style={styles.metaChip}>
                        <Text style={styles.metaChipText}>, End date: </Text>
                        <Text style={styles.deadlinePill}>{formatDeadline(poll.deadline)}</Text>
                    </View>
                )}


            </View>


            {!alreadyVoted && poll.pollType === "single" && (
                <View style={styles.noticeRow}>
                    <Ionicons name="checkmark-circle" size={22} color="#1F9F4E" />
                    <Text style={styles.noticeText}>
                        Cast your vote now! You have 30s to change your vote after voting.
                    </Text>
                </View>
            )}

            {alreadyVoted && poll.pollType === "single" ? (
                <View style={styles.noticeRow}>
                    <Ionicons name="checkmark-circle" size={22} color="#1F9F4E" />
                    <Text style={styles.noticeText}>
                        {votedAt && (Date.now() - votedAt.getTime()) / 1000 <= 30
                            ? `You have ${Math.max(0, 30 - Math.floor((Date.now() - votedAt.getTime()) / 1000))}s left to change your vote.`
                            : "Your vote is now locked and cannot be changed."}
                    </Text>
                </View>
            ) :
                poll.pollType != "single" && (
                    <View style={styles.noticeRow}>
                        <Ionicons name="checkmark-circle" size={25} color="#1F9F4E" />
                        <Text style={styles.noticeText}>1 vote = GHS 1.00, vote more for your aspirant to win. Load your wallet now</Text>
                    </View>
                )

            }




            <View style={styles.body}>
                <ScrollView
                    style={styles.scroll}
                    contentContainerStyle={styles.scrollContent}
                    showsVerticalScrollIndicator={false}
                    refreshControl={
                        <RefreshControl refreshing={refreshing} onRefresh={onRefresh}
                            tintColor="#1F9F4E" colors={["#1F9F4E"]} />
                    }
                >




                    {/* Aspirant cards */}
                    {sorted.length === 0 ? (
                        <View style={styles.emptyAspirantsWrap}>
                            <Ionicons name="people-outline" size={36} color="#d1d5db" />
                            <Text style={styles.emptyText}>No aspirants registered yet.</Text>
                        </View>
                    ) : (
                        <View style={styles.cardsWrap}>
                            {sorted.map((asp, index) => {
                                const isMultiple = poll.pollType === "multiple";
                                const hasVotedThis = votedEmails.includes(asp.email);
                                const myCountForThis = isMultiple ? countFor(votedEmails, asp.email) : (hasVotedThis ? 1 : 0);
                                const isToggling = togglingEmail === asp.email;
                                const rankLabel = RANK_LABELS[index] ?? `${index + 1}th`;
                                const avatarColor = AVATAR_COLORS[index % AVATAR_COLORS.length];
                                const isVoted = lockedIndices.has(index);
                                const isPayingForThis = payingFor === asp.email;
                                const parsedQty = parseInt(voteQty, 10);

                                return (
                                    <View key={asp.email} style={styles.card}>
                                        {/* Top row */}
                                        <View style={styles.cardTopRow}>

                                            <View style={styles.pollLogoWrapper}>
                                                <Image
                                                    source={require("@/assets/images/userImagePlaceHolder.png")}
                                                    style={styles.avatarPlaceholder}
                                                    resizeMode="contain"
                                                />
                                                {asp.photo ? (<Image
                                                    source={{ uri: asp.photo }}
                                                    style={styles.pollLogoInner}
                                                    resizeMode="cover"
                                                />) : (
                                                    <View style={[styles.avatar, { backgroundColor: asp.photo || avatarColor }]}>
                                                        <Text style={styles.avatarText}>
                                                            {asp.name?.charAt(0).toUpperCase() ?? '?'}
                                                        </Text>
                                                    </View>
                                                )}
                                            </View>




                                            <View style={styles.cardNameBlock}>
                                                <Text style={styles.cardName} ellipsizeMode="tail" numberOfLines={1}>{asp.name}</Text>
                                                <Text style={styles.cardEmail} ellipsizeMode="tail" numberOfLines={1}>{asp.email}</Text>
                                            </View>
                                            <View style={styles.timeBadge}>
                                                <Ionicons name="time-outline" size={11} color="#6b7280" />
                                                <Text style={styles.timeBadgeText}>{timeAgo(asp.lastVotedAt)}</Text>
                                            </View>
                                        </View>

                                        {/* Middle row */}
                                        <View style={styles.cardMiddleRow}>
                                            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                                                <View><Text style={styles.rankLabel}>{rankLabel}</Text></View>
                                                <View style={styles.pointsCircle}>
                                                    <Text style={styles.pointsCircleText}>{asp.votes || 0}</Text>
                                                </View>
                                                <View><Text style={styles.pointsLabel}>Votes</Text></View>
                                            </View>

                                            <View style={styles.rightGroup}>
                                                <View style={styles.statusMsgWrap}>
                                                    {isVoted && (
                                                        <Text
                                                            style={[styles.alreadyVotedText, { color: wait_checking_voter_validation === "Vote successful" ? "#1F9F4E" : "#ef4444" }]}
                                                            numberOfLines={1}
                                                            ellipsizeMode="tail"
                                                        >
                                                            {!isMultiple && wait_checking_voter_validation}
                                                        </Text>
                                                    )}
                                                </View>

                                                {!isMultiple ? (
                                                    // ── SINGLE-VOTE: original toggle thumb (unchanged) ──────
                                                    <View>
                                                        {isToggling ? (
                                                            <ActivityIndicator
                                                                size="small"
                                                                color={hasVotedThis ? "#1F9F4E" : "#9b9b9b"}
                                                                style={{ marginRight: 8 }}
                                                            />
                                                        ) : (
                                                            <TouchableOpacity
                                                                onPress={() => validateVoter(asp.email, index)}
                                                                disabled={!canVote || !!togglingEmailRef.current}
                                                                activeOpacity={0.7}
                                                                style={styles.thumbBtn}
                                                                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                                                            >
                                                                <AntDesign
                                                                    name="like1"
                                                                    size={18}
                                                                    color={hasVotedThis ? "#1F9F4E" : "#999"}
                                                                />
                                                                <Text style={[styles.thumbCount, hasVotedThis && styles.thumbCountActive]}>
                                                                    {hasVotedThis ? 1 : 0}
                                                                </Text>
                                                            </TouchableOpacity>
                                                        )}
                                                    </View>
                                                ) : (
                                                    // ── MULTIPLE-VOTE: free "−" removal, paid "+" via pay panel ──
                                                    <View style={styles.multiVoteRow}>

                                                        {isToggling && (
                                                            <ActivityIndicator size="small" color="#1F9F4E" style={{ width: 24 }} />
                                                        )}

                                                        <TouchableOpacity
                                                            onPress={() => {
                                                                if (!canVote) return;
                                                                setPayingFor(isPayingForThis ? null : asp.email);
                                                                setVoteQty("1");
                                                            }}
                                                            disabled={!canVote || !!togglingEmailRef.current}
                                                            activeOpacity={0.7}
                                                            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                                                            style={styles.multiVoteBtn}
                                                        >
                                                            <AntDesign
                                                                name="like1"
                                                                size={18}
                                                                color={"#999"}
                                                            />

                                                        </TouchableOpacity>
                                                    </View>
                                                )}
                                            </View>
                                        </View>

                                        {/* Pay panel — MULTIPLE-VOTE only, shown after tapping "+" ─────── */}
                                        {isMultiple && isPayingForThis && (
                                            <View style={styles.payPanel}>
                                                <Text style={styles.payPanelText}>
                                                    1 vote = GHS 1.00 - enter the number of votes you'd like to cast
                                                </Text>

                                                <View style={styles.payPanelRow}>
                                                    <TextInput
                                                        style={styles.payPanelInput}
                                                        keyboardType="number-pad"
                                                        value={voteQty}
                                                        onChangeText={(t) => setVoteQty(t.replace(/[^0-9]/g, ""))}
                                                        placeholder="1"
                                                        editable={!isPaying}
                                                        maxLength={5}
                                                    />
                                                    <Text style={styles.payPanelTotal}>
                                                        = GHS {((Number.isInteger(parsedQty) ? parsedQty : 0) * VOTE_PRICE_GHS).toFixed(2)}
                                                    </Text>
                                                </View>

                                                <View style={styles.payPanelBtnRow}>
                                                    <View><Text style={{ color: wait_checking_voter_validation === "Payment successul" ? "#22960eff" : "red" }}>{wait_checking_voter_validation}</Text></View>
                                                    <TouchableOpacity
                                                        onPress={() => { setPayingFor(null); setVoteQty("1"); }}
                                                        disabled={isPaying}
                                                        style={styles.payPanelCancelBtn}
                                                    >
                                                        <Text style={styles.payPanelCancelText}>Cancel</Text>
                                                    </TouchableOpacity>

                                                    <TouchableOpacity
                                                        onPress={() => handlePayAndVote(asp.email, index)}
                                                        disabled={isPaying || !Number.isInteger(parsedQty) || parsedQty < 1}
                                                        style={[
                                                            styles.payPanelPayBtn,
                                                            (isPaying || !Number.isInteger(parsedQty) || parsedQty < 1) && styles.payPanelPayBtnDisabled,
                                                        ]}
                                                        activeOpacity={0.8}
                                                    >
                                                        {isPaying ? (
                                                            <ActivityIndicator size="small" color="#fff" />
                                                        ) : (
                                                            <Text style={styles.payPanelPayText}>Pay</Text>
                                                        )}
                                                    </TouchableOpacity>
                                                </View>
                                            </View>
                                        )}
                                    </View>
                                );
                            })}
                        </View>
                    )}

                    {closed && (
                        <View style={[styles.noticeRow, styles.noticeRowClosed]}>
                            <Ionicons name="lock-closed-outline" size={16} color="#ef4444" />
                            <Text style={[styles.noticeText, styles.noticeTextClosed]}>
                                {expired ? "This poll has expired." : "This poll is now closed."}
                            </Text>
                        </View>
                    )}
                </ScrollView>
            </View>
        </ReusableScreen>
    );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
    loadingText: { fontSize: 14, color: "#9ca3af" },
    emptyText: { fontSize: 15, color: "#9ca3af", marginTop: 8, textAlign: "center" },

    header: {
        flexDirection: "row", alignItems: "center", justifyContent: "space-between",
        backgroundColor: "#fff", paddingHorizontal: 16, paddingVertical: 12,
        borderBottomWidth: 0.5, borderBottomColor: "#e5e7eb",
    },
    backBtn: {
        width: 32, height: 32, borderRadius: 16,
        backgroundColor: "#1F9F4E", alignItems: "center", justifyContent: "center",
    },


    body: { flex: 1, backgroundColor: "#fff", marginHorizontal: 12, marginBottom: 3, borderRadius: 12, overflow: "hidden" },
    scroll: { flex: 1 },
    scrollContent: { paddingBottom: 5, paddingTop: 3, backgroundColor: "#deead9ff", borderRadius: 12, overflow: "hidden" },

    statusRow: {
        flexDirection: "row", gap: 2, flexWrap: "wrap",
        paddingHorizontal: 18, paddingBottom: 4, paddingTop: 10, backgroundColor: "#fff",
    },
    statusBadge: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 20 },
    badgeActive: { backgroundColor: "#EAF6EE" },
    badgeClosed: { backgroundColor: "#fee2e2" },
    statusDot: { width: 6, height: 6, borderRadius: 3 },
    dotActive: { backgroundColor: "#1F9F4E" },
    dotClosed: { backgroundColor: "#ef4444" },
    statusText: { fontSize: 13, fontWeight: "600" },
    statusTextActive: { color: "#1F9F4E" },
    statusTextClosed: { color: "#ef4444" },
    metaChip: { flexDirection: "row", alignItems: "center", gap: 4 },
    metaChipText: { fontSize: 13, color: "#6b7280" },
    YouVotedForText: { fontSize: 13, color: "#20792bff", fontWeight: "600" },
    deadlinePill: {
        fontSize: 11, color: "#fff", fontWeight: "600",
        paddingVertical: 3, paddingHorizontal: 7,
        backgroundColor: "#2fa550de", borderRadius: 20,
        overflow: "hidden",
    },

    cardsWrap: { paddingHorizontal: 0 },

    card: {
        backgroundColor: "#fff", borderRadius: 12, padding: 10, marginVertical: 2, marginHorizontal: 5,
        borderWidth: 1, borderColor: "#ddd", marginBottom: 2,
    },
    cardTopRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    avatar: { width: 55, height: 55, borderRadius: 12, alignItems: "center", justifyContent: "center" },
    avatarText: { color: "#fff", fontWeight: "800", fontSize: 18 },
    cardNameBlock: { flex: 1, gap: 2 },
    cardName: { width: 250, fontSize: 14, fontWeight: "700", color: "#1a1a1a" },
    cardEmail: { width: 250, fontSize: 12, color: "#9ca3af" },

    timeBadge: {
        flexDirection: "row", alignItems: "center", gap: 4,
        backgroundColor: "#f3f4f6", paddingHorizontal: 8, paddingVertical: 5, borderRadius: 20,
    },
    timeBadgeText: { fontSize: 11, fontWeight: "600", color: "#6b7280" },

    cardMiddleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 14, flexWrap: "wrap" },
    rankLabel: { fontSize: 15, fontWeight: "600", color: "#6b7280", width: 36 },
    pointsCircle: {
        paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
        backgroundColor: "#e0efe5ff", alignItems: "center", justifyContent: "center",
    },
    pointsCircleText: { fontSize: 25, fontWeight: "800", color: "#15803d" },
    pointsLabel: { fontSize: 14, color: "#374151", marginLeft: 6 },

    thumbBtn: { flexDirection: "row", alignItems: "center", gap: 5, marginLeft: 16 },
    thumbCount: { fontSize: 13, fontWeight: "600", color: "#9b9b9b" },
    thumbCountActive: { color: "#1F9F4E" },

    // ── Multi-vote +/- control (multiple-type polls only) ─────────────────────
    multiVoteRow: { flexDirection: "row", alignItems: "center", gap: 6, marginLeft: 8, flexShrink: 0 },
    multiVoteBtn: {
        width: 36, height: 36, borderRadius: 40, padding: 10,
        backgroundColor: "#ebeff5ff", alignItems: "center", justifyContent: "center",
    },
    multiVoteBtnDisabled: { backgroundColor: "#f9fafb" },

    // ── Right-hand group (status message + vote controls) ─────────────────────
    rightGroup: {
        flexDirection: "row",
        alignItems: "center",
        flexShrink: 1,
        justifyContent: "flex-end",
        flexWrap: "wrap",
        maxWidth: "60%",
    },
    statusMsgWrap: {
        flexShrink: 1,
        maxWidth: 70,
        alignItems: "flex-end",
        justifyContent: "center",
        marginRight: 4,
    },

    // ── Pay panel (shown when "+" is tapped on a multiple-vote poll) ──────────
    payPanel: {
        marginTop: 10,
        padding: 10,
        borderRadius: 10,
        backgroundColor: "#f3f4f6",
        borderWidth: 1,
        borderColor: "#e5e7eb",
        gap: 8,
    },
    payPanelText: { fontSize: 12, color: "#4b5563", fontWeight: "500" },
    payPanelRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    payPanelInput: {
        width: 70, height: 36, borderRadius: 8,
        backgroundColor: "#fff", borderWidth: 1, borderColor: "#d1d5db",
        paddingHorizontal: 10, fontSize: 14, fontWeight: "600", color: "#1a1a1a",
    },
    payPanelTotal: { fontSize: 14, fontWeight: "700", color: "#15803d" },
    payPanelBtnRow: { alignItems: "center", flexDirection: "row", justifyContent: "flex-end", gap: 8 },
    payPanelCancelBtn: {
        paddingHorizontal: 14, height: 36, borderRadius: 8,
        alignItems: "center", justifyContent: "center",
        backgroundColor: "#e5e7eb",
    },
    payPanelCancelText: { fontSize: 13, fontWeight: "600", color: "#4b5563" },
    payPanelPayBtn: {
        paddingHorizontal: 20, height: 36, borderRadius: 8,
        alignItems: "center", justifyContent: "center",
        backgroundColor: "#1F9F4E",
    },
    payPanelPayBtnDisabled: { backgroundColor: "#a7d9b8" },
    payPanelPayText: { fontSize: 13, fontWeight: "700", color: "#fff" },

    noticeRow: {
        flexDirection: "row", alignItems: "center",
        marginHorizontal: 6, marginVertical: 5, padding: 12, gap: 4,
        borderRadius: 10, backgroundColor: "#cffbe5e1", borderWidth: 3, borderColor: "#fff"
    },
    noticeRowClosed: { backgroundColor: "#fee2e2" },
    noticeText: { lineHeight: 18, fontSize: 13, color: "#494c4aff", flex: 1, fontWeight: "500" },
    noticeTextClosed: { color: "#ef4444" },


    footerMetaText: { fontSize: 13, color: "#9ca3af", textAlign: "center" },
    anonBadge: { flexDirection: "row", alignItems: "center", gap: 4 },
    anonText: { fontSize: 12, color: "#6b7280" },

    emptyAspirantsWrap: { alignItems: "center", paddingVertical: 40, gap: 10, backgroundColor: "#fff" },

    alreadyVotedText: {
        fontSize: 14,
        color: "#ef4444",
        fontWeight: "600",
        textAlign: "right",
    },




    // add to header, replacing the old fixed-width version

    headerTitle: {
        width: "90%",           // ← replaces flex: 1 — gives Text a bounded width so ellipsis/numberOfLines works
        fontSize: 16,
        fontWeight: "700",
        color: "#1a1a1a",
        textAlign: "center",
        marginHorizontal: 8,
        marginBottom: 3,
        lineHeight: 20,
        letterSpacing: -0.2,
    },
    // new
    topHeader: {
        flexDirection: "row",
        alignItems: "flex-start",
        marginHorizontal: 16,
        paddingTop: Platform.select({ ios: 12, android: 16, default: 20 }),
        borderBottomWidth: 1, borderColor: "#ddd", paddingBottom: 5,
    },
    titleBlock: {
        flex: 1,
        alignItems: "center",
        justifyContent: "flex-start",
        paddingHorizontal: 4, position: "relative", bottom: 5,
    },
    headerSpacer: {
        width: 32, // matches backBtn's width exactly
    },
    pollTypeBadge: {
        paddingHorizontal: 10,
        paddingVertical: 2,
        borderRadius: 10,
    },
    pollTypeBadgeText: {
        color: "#0c6c59ff",
        fontSize: 14,
        fontWeight: "800",
    },

    // footerMeta: replace the old version with this
    footerMeta: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        flexWrap: "wrap",
        rowGap: 4,
        columnGap: 6,
        paddingTop: 4,   // bumped from 2
    },


    avatarImage: { width: "100%", height: "100%", borderRadius: 25 },
    avatarPlaceholder: { width: "70%", height: "70%", position: "absolute" },



    pollLogoWrapper: {
        width: 52,
        height: 52,
        borderRadius: 48,
        backgroundColor: "#F3F4F6",
        borderWidth: 1,
        borderColor: "#E5E7EB",
        padding: 6,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
    },
    pollLogoInner: {
        width: "140%",
        height: "140%",
    },
});
