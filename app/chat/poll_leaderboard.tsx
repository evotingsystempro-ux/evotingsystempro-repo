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
    limit,
    getDocs,
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
    requires_voters_validation: boolean;
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

    useEffect(() => {
        if (!pollId || !creatorEmail) return;
        return onSnapshot(
            doc(db, "POLL_TITLE_DB", creatorEmail, "polls", pollId),
            (snap) => {
                if (snap.exists()) setPoll(snap.data() as Poll);
                setLoadingPoll(false);
            },
            (err) => { console.error("poll listener:", err); setLoadingPoll(false); }
        );
    }, [pollId, creatorEmail]);

    // ── Aspirants (live) ──────────────────────────────────────────────────────

    useEffect(() => {
        if (!pollId || !creatorEmail) return;
        return onSnapshot(
            collection(db, "ASPIRANTS_DETAILS_DB", creatorEmail, pollId),
            (snap) => {
                setAspirants(snap.docs.map(d => {
                    const data = d.data();
                    const raw = data.lastVotedAt;
                    return {
                        email: data.email ?? d.id,
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
    }, [pollId, creatorEmail]);

    // ── Load my existing vote(s) ──────────────────────────────────────────────
    // Path: VOTERS_DB/{voterEmail}/{pollId}/receipt

    const loadMyVotes = useCallback(async () => {
        if (!rawUserEmail || !pollId) return;
        try {
            const snap = await getDoc(doc(db, "VOTERS_DB", rawUserEmail, pollId, "receipt"));
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

    const sanitizeDocId = (raw: string) => {
        const cleaned = raw.trim().replace(/\//g, "-").replace(/\s+/g, " ");
        return cleaned.length ? cleaned : "";
    };

    const isValidEmail = (value: string) =>
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

    const checkVoterValidated = async (
        creatorEmail: string,
        pollId: string,
        idOrEmail: string
    ): Promise<boolean> => {
        const trimmed = idOrEmail.trim();
        if (!creatorEmail || !pollId || !trimmed) return false;

        const votersCollection = collection(
            db,
            "VALIDATED_VOTERS_DB",
            creatorEmail,
            pollId
        );

        // 1. Try as a doc ID (voter code / index no.) — documents are keyed by
        //    sanitizeDocId(code), same as when the poll creator uploaded/entered
        //    the list.
        const codeId = sanitizeDocId(trimmed);
        if (codeId) {
            const codeSnap = await getDoc(doc(votersCollection, codeId));
            if (codeSnap.exists()) return true;
        }

        // 2. Fall back to matching on the "email" field (case-insensitive, since
        //    emails are stored lowercased on write).
        if (isValidEmail(trimmed)) {
            const emailQuery = query(
                votersCollection,
                where("email", "==", trimmed.toLowerCase()),
                limit(1)
            );
            const emailSnap = await getDocs(emailQuery);
            if (!emailSnap.empty) return true;
        }

        return false;
    };

    // const pollId = "POLL_1782998497301_A8AIA";
    //   const creatorEmail = "litmusberk@gmail.com";

    const [idOrEmail, setIdOrEmail] = useState(userid || rawUserEmail);
    const [wait_checking_voter_validation, setWait_checking_voter_validation]: any = useState("");

    const validateVoter = async (aspirantEmail: string, index: number) => {

        setLockedIndices(new Set());
        setWait_checking_voter_validation("Loading...");
        setLockedIndices(prev => new Set(prev).add(index));


        if (!pollId || !creatorEmail) {
            console.log("Missing pollId or creatorEmail — cannot validate voter.");

            return;
        }

        if (!idOrEmail.trim()) return;
        try {
            const isVoterValidated = await checkVoterValidated(
                String(creatorEmail),
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

        if (poll.requires_voters_validation === true && !isVoterValidated) {
            setLockedIndices(new Set());
            setWait_checking_voter_validation("You can't vote in this poll");
            setLockedIndices(prev => new Set(prev).add(index));
            return;
        }
        setWait_checking_voter_validation("");

        const current = votedEmailsRef.current;
        const hasVotedThis = current.includes(aspirantEmail);

        setTogglingEmailSafe(aspirantEmail);

        const aspirantRef = (email: string) =>
            doc(db, "ASPIRANTS_DETAILS_DB", creatorEmail, pollId, email);

        const voterDocRef = doc(db, "VOTERS_DB", rawUserEmail, pollId, "receipt");

        try {
            if (hasVotedThis) {
                // ── Remove vote ───────────────────────────────────────────────
                await updateDoc(aspirantRef(aspirantEmail), {
                    votes: increment(-1),
                    lastVotedAt: serverTimestamp(),
                });

                const next = current.filter(e => e !== aspirantEmail);

                await setDoc(voterDocRef, {
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

    // ── Repeatable vote — MULTIPLE-VOTE POLLS ONLY (new) ──────────────────────
    // A voter can press "+" on the SAME aspirant as many times as they like
    // (e.g. 20 votes for X, then 50 votes for Y). "−" removes one vote at a
    // time from that aspirant, down to a minimum of 0.

    const handleMultiVote = async (aspirantEmail: string, delta: 1 | -1) => {
        if (!poll || !rawUserEmail || !pollId || !creatorEmail) {
            Alert.alert("Not ready", "Please wait a moment and try again.");
            return;
        }

        if (togglingEmailRef.current) return;

        if (poll.status === "closed" || isExpired(poll.deadline)) {
            Alert.alert("Poll closed", "This poll is no longer accepting votes.");
            return;
        }

        const current = votedEmailsRef.current;
        const myCountForThis = countFor(current, aspirantEmail);

        // Can't remove a vote that doesn't exist
        if (delta === -1 && myCountForThis === 0) return;

        setTogglingEmailSafe(aspirantEmail);

        const aspirantRef = doc(db, "ASPIRANTS_DETAILS_DB", creatorEmail, pollId, aspirantEmail);
        const voterDocRef = doc(db, "VOTERS_DB", rawUserEmail, pollId, "receipt");

        try {
            await updateDoc(aspirantRef, {
                votes: increment(delta),
                lastVotedAt: serverTimestamp(),
            });

            let next: string[];
            if (delta === 1) {
                // Add another vote for this aspirant — duplicates are allowed
                next = [...current, aspirantEmail];
            } else {
                // Remove exactly one occurrence of this aspirant
                next = [...current];
                const removeIdx = next.lastIndexOf(aspirantEmail);
                if (removeIdx !== -1) next.splice(removeIdx, 1);
            }

            // Overwrite the whole array — arrayUnion/arrayRemove would dedupe
            // and break the "vote many times for the same aspirant" feature.
            await setDoc(voterDocRef, {
                pollTitle: poll.title,
                creatorEmail,
                aspirantVoted: next,
                votedAt: serverTimestamp(),
            }, { merge: true });

            syncVotedEmails(next);
        } catch (err: any) {
            console.error("handleMultiVote error:", err);
            Alert.alert("Vote failed", err?.message ?? "Could not update vote. Please try again.");
            await loadMyVotes();
        } finally {
            setTogglingEmailSafe(null);
        }
    };

    const onRefresh = () => { setRefreshing(true); loadMyVotes(); };

    const sortedRef = useRef<Aspirant[]>([]);

    // ── Derived ───────────────────────────────────────────────────

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

    // ── Loading ───────────────────────────────────────────────

    if (loading) {

        return (
            <ReusableScreen>
                <View style={styles.header}>
                    <TouchableOpacity onPress={() => router.navigate("./PollsListScreen")} style={styles.backBtn}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                        <Ionicons name="arrow-back" size={18} color="#1F9F4E" />
                    </TouchableOpacity>
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

    // ── Render ───────────<Text style={[styles.pollTitle, { flex: 1, }]} ellipsizeMode="tail" numberOfLines={2}>─────────────────────────

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
                        <Text style={styles.footerMetaText}>Creator: {poll.creatorName},</Text>

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

                {poll.requires_voters_validation === true ? (
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
                </View>
                {poll.pollType === "multiple" && myTotalVotesCast > 0 && (
                    <View style={styles.metaChip}>
                        <Ionicons name="person-outline" size={14} color="#6b7280" />
                        <Text style={styles.metaChipText}>
                            You've cast {myTotalVotesCast} vote{myTotalVotesCast !== 1 ? "s" : ""}
                        </Text>
                    </View>
                )}
                {poll.deadline && (
                    <View style={styles.metaChip}>
                        <Ionicons name="time-outline" size={18} color="#6b7280" />
                        <Text style={styles.metaChipText}>Voting ends: </Text>
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

                                return (
                                    <View key={asp.email} style={styles.card}>
                                        {/* Top row */}
                                        <View style={styles.cardTopRow}>

                                            <View>
                                                <Image
                                                    source={require("@/assets/images/userImagePlaceHolder.png")}
                                                    style={styles.avatarPlaceholder}
                                                    resizeMode="contain"
                                                />
                                                {asp.photo && asp.photo.length > 10 ? (


                                                    <View style={styles.pollLogoWrapper}>
                                                        <Image
                                                            source={{ uri: asp.photo }}
                                                            style={styles.pollLogoInner}
                                                            resizeMode="cover"
                                                        />
                                                    </View>
                                                ) : (
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

                                            <View style={{ flexDirection: "row", alignItems: "center", }}>
                                                <View style={{ flexDirection: "row", alignItems: "center", width: 100, justifyContent: "flex-end" }}>
                                                    {isVoted && (
                                                        <Text style={[styles.alreadyVotedText, { color: wait_checking_voter_validation === "Vote successful" ? "#1F9F4E" : "#ef4444" }]}>{wait_checking_voter_validation}</Text>
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
                                                    // ── MULTIPLE-VOTE: repeatable +/- voting (new) ──────────
                                                    <View style={styles.multiVoteRow}>
                                                        <TouchableOpacity
                                                            onPress={() => handleMultiVote(asp.email, -1)}
                                                            disabled={!canVote || !!togglingEmailRef.current || myCountForThis === 0}
                                                            activeOpacity={0.7}
                                                            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                                                            style={[styles.multiVoteBtn, myCountForThis === 0 && styles.multiVoteBtnDisabled]}
                                                        >
                                                            <Ionicons name="remove" size={16} color={myCountForThis === 0 ? "#d1d5db" : "#ef4444"} />
                                                        </TouchableOpacity>

                                                        {isToggling ? (
                                                            <ActivityIndicator size="small" color="#1F9F4E" style={{ width: 28 }} />
                                                        ) : (
                                                            <Text
                                                                style={[
                                                                    styles.thumbCount,
                                                                    myCountForThis > 0 && styles.thumbCountActive,
                                                                    { width: 22, textAlign: "center" },
                                                                ]}
                                                            >
                                                                {myCountForThis}
                                                            </Text>
                                                        )}

                                                        <TouchableOpacity
                                                            onPress={() => handleMultiVote(asp.email, 1)}
                                                            disabled={!canVote || !!togglingEmailRef.current}
                                                            activeOpacity={0.7}
                                                            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                                                            style={styles.multiVoteBtn}
                                                        >
                                                            <Ionicons name="add" size={16} color="#1F9F4E" />
                                                        </TouchableOpacity>
                                                    </View>
                                                )}
                                            </View>
                                        </View>
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
    avatar: { width: 45, height: 45, borderRadius: 12, alignItems: "center", justifyContent: "center" },
    avatarText: { color: "#fff", fontWeight: "800", fontSize: 18 },
    cardNameBlock: { flex: 1, gap: 2 },
    cardName: { width: 250, fontSize: 14, fontWeight: "700", color: "#1a1a1a" },
    cardEmail: { width: 250, fontSize: 12, color: "#9ca3af" },

    timeBadge: {
        flexDirection: "row", alignItems: "center", gap: 4,
        backgroundColor: "#f3f4f6", paddingHorizontal: 8, paddingVertical: 5, borderRadius: 20,
    },
    timeBadgeText: { fontSize: 11, fontWeight: "600", color: "#6b7280" },

    cardMiddleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10, marginTop: 14 },
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

    // ── New: multi-vote +/- control (multiple-type polls only) ───────────────
    multiVoteRow: { flexDirection: "row", alignItems: "center", gap: 8, marginLeft: 12 },
    multiVoteBtn: {
        width: 26, height: 26, borderRadius: 13,
        backgroundColor: "#f3f4f6", alignItems: "center", justifyContent: "center",
    },
    multiVoteBtnDisabled: { backgroundColor: "#f9fafb" },

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
