import React, { useEffect, useState, useCallback } from "react";
import {
    View,
    Text,
    TouchableOpacity,
    ScrollView,
    StyleSheet,
    Platform,
    ActivityIndicator,
    RefreshControl,
    TextInput,
    LayoutAnimation,
    UIManager,
    Image,
} from "react-native";
import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import ReusableScreen from "@/components/ReusableScreen";
import { db } from "@/firebase";
import { collectionGroup, getDocs } from "firebase/firestore";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface PollSummary {
    pollId: string;
    title: string;
    pollType: "single" | "multiple";
    status: "active" | "closed";
    deadline: string | null;
    creatorEmail: string;
    creatorName: string;
    logUrl?: string; // Added logUrl for the poll logo
    aspirantCount: number;
    dateCreated: string;
    createdAt: number;
    showResults: boolean;
    isAnonymous: boolean;
    requires_voters_validation: boolean;
    poll_verification_status: "verified" | "not_verified";
}

interface CreatorGroup {
    creatorEmail: string;
    creatorName: string;
    polls: PollSummary[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const isExpired = (deadline: string | null) =>
    deadline ? new Date(deadline) < new Date() : false;

const isPollClosed = (p: PollSummary) =>
    p.status === "closed" || isExpired(p.deadline);

const formatDate = (dateStr: string) => dateStr;

const AVATAR_PALETTE = ["#1F9F4E", "#2563EB", "#D97706", "#7C3AED", "#DB2777", "#0D9488"];
const avatarColorFor = (key: string) => {
    let hash = 0;
    for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
    return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
};

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function PollsListScreen() {
    const [groups, setGroups] = useState<CreatorGroup[]>([]);
    const [filtered, setFiltered] = useState<CreatorGroup[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [search, setSearch] = useState("");
    const [filter, setFilter] = useState<"all" | "active" | "closed">("all");
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

    // ── Fetch all poll docs via collectionGroup query ─────────────────────────

    const fetchPolls = useCallback(async () => {
        try {
            const pollsSnap = await getDocs(collectionGroup(db, "polls"));

            const byCreator = new Map<string, PollSummary[]>();
            const creatorNames = new Map<string, string>();

            pollsSnap.docs.forEach((pd) => {
                const d = pd.data();
                const creatorEmail: string = d.creatorEmail ?? pd.ref.parent.parent?.id ?? "unknown";
                const creatorName: string = d.creatorName ?? "Unknown";

                const summary: PollSummary = {
                    pollId: d.pollId ?? pd.id,
                    title: d.title ?? "Untitled Poll",
                    pollType: d.pollType ?? "single",
                    status: d.status ?? "active",
                    deadline: d.deadline ?? null,
                    creatorEmail,
                    creatorName,
                    logUrl: d.logUrl ?? d.logoUrl, // Accounts for the logUrl parameter
                    aspirantCount: d.aspirantCount ?? 0,
                    dateCreated: d.dateCreated ?? "",
                    createdAt: d.createdAt?.toMillis?.() ?? 0,
                    showResults: d.showResults ?? true,
                    isAnonymous: d.isAnonymous ?? false,
                    requires_voters_validation: d.requires_voters_validation ?? "false",
                    poll_verification_status: d.poll_verification_status ?? "not_verified",
                };

                if (!byCreator.has(creatorEmail)) byCreator.set(creatorEmail, []);
                byCreator.get(creatorEmail)!.push(summary);
                creatorNames.set(creatorEmail, creatorName);
            });

            const groupList: CreatorGroup[] = Array.from(byCreator.entries()).map(
                ([creatorEmail, polls]) => {
                    polls.sort((a, b) => b.createdAt - a.createdAt);
                    return {
                        creatorEmail,
                        creatorName: creatorNames.get(creatorEmail) ?? "Unknown",
                        polls,
                    };
                }
            );

            groupList.sort((a, b) => b.polls[0].createdAt - a.polls[0].createdAt);
            setGroups(groupList);
            applyFilters(groupList, search, filter);
        } catch (err) {
            console.error("fetchPolls:", err);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => { fetchPolls(); }, [fetchPolls]);

    // ── Filter / search ───────────────────────────────────────────────────────

    const applyFilters = (
        source: CreatorGroup[],
        q: string,
        f: "all" | "active" | "closed"
    ) => {
        const term = q.toLowerCase().trim();
        const result: CreatorGroup[] = [];
        for (const group of source) {
            const polls = group.polls.filter((p) => {
                const matchSearch =
                    !term ||
                    p.title.toLowerCase().includes(term) ||
                    group.creatorName.toLowerCase().includes(term);
                const matchFilter =
                    f === "all" ||
                    (f === "active" && !isPollClosed(p)) ||
                    (f === "closed" && isPollClosed(p));
                return matchSearch && matchFilter;
            });
            if (polls.length > 0) result.push({ ...group, polls });
        }
        setFiltered(result);
    };

    useEffect(() => {
        applyFilters(groups, search, filter);
    }, [search, filter, groups]);

    const onRefresh = () => { setRefreshing(true); fetchPolls(); };

    const openPoll = (poll: PollSummary) => {
        router.navigate({
            pathname: "./poll_leaderboard",
            params: { pollId: poll.pollId, creatorEmail: poll.creatorEmail },
        });
    };

    const toggleGroup = (creatorEmail: string) => {
        if (Platform.OS !== "web") {
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        }
        setCollapsed((prev) => {
            const next = new Set(prev);
            if (next.has(creatorEmail)) next.delete(creatorEmail);
            else next.add(creatorEmail);
            return next;
        });
    };

    const totalPolls = filtered.reduce((s, g) => s + g.polls.length, 0);
    const livePolls = filtered.reduce(
        (s, g) => s + g.polls.filter((p) => !isPollClosed(p)).length, 0
    );

    const truncateMiddle = useCallback(
        (value?: string, start = 12, end = 12): string | undefined => {
            if (!value || value.length <= start + end) return value;
            return `${value.slice(0, start)}...${value.slice(-end)}`;
        },
        []
    );

    // ── Loading ───────────────────────────────────────────────────────────────

    if (loading) {
        return (
            <ReusableScreen>
                <View style={styles.header}>
                    <TouchableOpacity onPress={() => router.navigate("./PollsListScreen")} style={styles.backBtn}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                        <Ionicons name="arrow-back" size={20} color="#ffffffff" />
                    </TouchableOpacity>
                    <Text style={styles.headerTitle}>All Polls</Text>
                    <View style={{ width: 32 }} />
                </View>
                <View style={styles.centered}>
                    <ActivityIndicator size="large" color="#1F9F4E" />
                    <Text style={styles.loadingText}>Fetching latest polls...</Text>
                </View>
            </ReusableScreen>
        );
    }

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <ReusableScreen>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                    <Ionicons name="arrow-back" size={20} color="#fff" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>All Polls</Text>
                <View style={styles.headerCountPill}>
                    <Text style={styles.headerCountText}>{totalPolls}</Text>
                </View>
            </View>

            {/* Search bar */}
            <View style={styles.searchSection}>
                <View style={styles.searchWrap}>
                    <Ionicons name="search-outline" size={18} color="#8c939fff" />
                    <TextInput
                        style={styles.searchInput}
                        placeholder="Search polls or creators..."
                        placeholderTextColor="#949ba8ff"
                        value={search}
                        onChangeText={setSearch}
                        returnKeyType="search"
                        clearButtonMode="while-editing"
                        {...(Platform.OS === "web" && { outlineStyle: "none" } as any)}
                    />
                    {search.length > 0 && Platform.OS !== "ios" && (
                        <TouchableOpacity
                            onPress={() => setSearch("")}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                            <Ionicons name="close-circle" size={18} color="#9CA3AF" />
                        </TouchableOpacity>
                    )}
                </View>

                {/* Filter tabs */}
                <View style={styles.filterRow}>
                    <View style={styles.filterPillGroup}>
                        {(["all", "active", "closed"] as const).map((f) => (
                            <TouchableOpacity
                                key={f}
                                style={[styles.filterTab, filter === f && styles.filterTabActive]}
                                onPress={() => setFilter(f)}
                                activeOpacity={0.7}
                            >
                                <Text style={[styles.filterTabText, filter === f && styles.filterTabTextActive]}>
                                    {f.charAt(0).toUpperCase() + f.slice(1)}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                    {livePolls > 0 && filter === "all" && (
                        <View style={styles.liveBadge}>
                            <View style={styles.liveBadgeDot} />
                            <Text style={styles.liveBadgeText}>{livePolls} Live</Text>
                        </View>
                    )}
                </View>
            </View>

            {/* List */}
            <ScrollView
                style={styles.scroll}
                contentContainerStyle={[
                    styles.scrollContent,
                    filtered.length === 0 && styles.scrollEmpty,
                ]}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={onRefresh}
                        tintColor="#1F9F4E"
                        colors={["#1F9F4E"]}
                    />
                }
            >
                {filtered.length === 0 ? (
                    <View style={styles.emptyWrap}>
                        <View style={styles.emptyIconWrap}>
                            <MaterialIcons name="how-to-vote" size={40} color="#9CA3AF" />
                        </View>
                        <Text style={styles.emptyTitle}>No polls found</Text>
                        <Text style={styles.emptyDesc}>
                            {search
                                ? "Try a different search term or filter."
                                : "No polls have been created yet."}
                        </Text>
                    </View>
                ) : (
                    filtered.map((group) => {
                        const isCollapsed = collapsed.has(group.creatorEmail);
                        const liveInGroup = group.polls.filter((p) => !isPollClosed(p)).length;
                        const avatarColor = avatarColorFor(group.creatorEmail);

                        return (
                            <View key={group.creatorEmail} style={styles.groupCard}>
                                {/* Creator header */}
                                <TouchableOpacity
                                    style={styles.creatorHeader}
                                    onPress={() => toggleGroup(group.creatorEmail)}
                                    activeOpacity={0.7}
                                >
                                    <View style={[styles.creatorAvatar, { backgroundColor: avatarColor }]}>
                                        <Text style={styles.creatorAvatarText}>
                                            {group.creatorName.charAt(0).toUpperCase()}
                                        </Text>
                                    </View>

                                    <View style={styles.creatorInfo}>
                                        <Text style={styles.creatorName} numberOfLines={1}>
                                            {group.creatorName}
                                        </Text>
                                        <Text style={styles.creatorEmail} numberOfLines={1}>
                                            {truncateMiddle(group.creatorEmail, 15, 10)}
                                        </Text>
                                    </View>

                                    <View style={styles.creatorRight}>
                                        {liveInGroup > 0 && <View style={styles.miniLiveDot} />}
                                        <Text style={styles.creatorPollCount}>
                                            {group.polls.length}
                                        </Text>
                                        <Ionicons
                                            name={isCollapsed ? "chevron-down" : "chevron-up"}
                                            size={18}
                                            color="#9CA3AF"
                                        />
                                    </View>
                                </TouchableOpacity>

                                {/* Poll rows */}
                                {!isCollapsed && (
                                    <View style={styles.pollsWrap}>
                                        {group.polls.map((poll) => {
                                            const closed = isPollClosed(poll);
                                            const expired = isExpired(poll.deadline);
                                            const requiresVoterValidation = poll.requires_voters_validation === true;
                                            const verified = poll.poll_verification_status === "verified";

                                            return (
                                                <TouchableOpacity
                                                    key={poll.pollId}
                                                    style={styles.pollCard}
                                                    onPress={() => openPoll(poll)}
                                                    activeOpacity={0.6}
                                                >
                                                    {/* Top Section: Logo & Details */}
                                                    <View style={styles.pollTopSection}>

                                                        {/* Logo Thumbnail */}
                                                        {poll.logUrl ? (
                                                            <Image
                                                                source={{ uri: poll.logUrl }}
                                                                style={styles.pollLogo}
                                                                resizeMode="cover"
                                                            />
                                                        ) : (
                                                            <View style={styles.pollLogoPlaceholder}>
                                                                <Ionicons name="stats-chart" size={24} color="#9CA3AF" />
                                                            </View>
                                                        )}

                                                        {/* Info Body */}
                                                        <View style={styles.pollDetailsBody}>
                                                            <View style={styles.pollHeader}>
                                                                <Text style={styles.pollTitle} numberOfLines={2}>
                                                                    {poll.title}
                                                                </Text>
                                                                <View style={[
                                                                    styles.statusBadge,
                                                                    closed ? styles.badgeClosed : styles.badgeActive,
                                                                ]}>
                                                                    <Text style={[
                                                                        styles.badgeText,
                                                                        closed ? styles.badgeTextClosed : styles.badgeTextActive,
                                                                    ]}>
                                                                        {closed ? (expired ? "Expired" : "Closed") : "Live"}
                                                                    </Text>
                                                                </View>
                                                            </View>

                                                            {/* Metadata */}
                                                            <View style={styles.pollMetaRow}>
                                                                {poll.dateCreated ? (
                                                                    <Text style={styles.metaText}>
                                                                        {formatDate(poll.dateCreated)}
                                                                    </Text>
                                                                ) : null}

                                                                <View style={styles.metaDivider} />

                                                                <View style={styles.metaIconGroup}>
                                                                    <Ionicons name="people" size={14} color="#6B7280" />
                                                                    <Text style={styles.metaText}>
                                                                        {poll.aspirantCount} Aspirant{poll.aspirantCount !== 1 ? "s" : ""}
                                                                    </Text>
                                                                </View>

                                                                {poll.isAnonymous && (
                                                                    <>
                                                                        <View style={styles.metaDivider} />
                                                                        <View style={styles.metaIconGroup}>
                                                                            <Ionicons name="eye-off" size={14} color="#6B7280" />
                                                                            <Text style={styles.metaText}>Anon</Text>
                                                                        </View>
                                                                    </>
                                                                )}

                                                                {poll.pollType === "multiple" && (
                                                                    <>
                                                                        <View style={styles.metaDivider} />
                                                                        <View style={styles.metaIconGroup}>
                                                                            <Ionicons name="layers" size={14} color="#6B7280" />
                                                                            <Text style={styles.metaText}>Multi</Text>
                                                                        </View>
                                                                    </>
                                                                )}
                                                            </View>
                                                        </View>
                                                    </View>

                                                    {/* Bottom Row: Badges & Arrow */}
                                                    <View style={styles.pollFooter}>
                                                        <View style={styles.badgeGroup}>
                                                            {requiresVoterValidation ? (
                                                                <View style={styles.tagVIP}>
                                                                    <Ionicons name="shield-checkmark" size={12} color="#D97706" />
                                                                    <Text style={styles.tagTextVIP}>VIP Only</Text>
                                                                </View>
                                                            ) : (
                                                                <View style={styles.tagStandard}>
                                                                    <Ionicons name="globe-outline" size={12} color="#4B5563" />
                                                                    <Text style={styles.tagTextStandard}>Public</Text>
                                                                </View>
                                                            )}

                                                            {verified ? (
                                                                <View style={styles.tagVerified}>
                                                                    <Ionicons name="checkmark-circle" size={12} color="#1F9F4E" />
                                                                    <Text style={styles.tagTextVerified}>Verified</Text>
                                                                </View>
                                                            ) : (
                                                                <View style={styles.tagUnverified}>
                                                                    <Ionicons name="alert-circle" size={12} color="#EF4444" />
                                                                    <Text style={styles.tagTextUnverified}>Unverified</Text>
                                                                </View>
                                                            )}
                                                        </View>

                                                        <Ionicons name="arrow-forward" size={16} color="#9CA3AF" />
                                                    </View>
                                                </TouchableOpacity>
                                            );
                                        })}
                                    </View>
                                )}
                            </View>
                        );
                    })
                )}
            </ScrollView>
        </ReusableScreen>
    );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, backgroundColor: '#F9FAFB' },
    loadingText: { fontSize: 14, color: "#6B7280", fontWeight: "500" },

    header: {
        flexDirection: "row", alignItems: "center", justifyContent: "space-between",
        backgroundColor: "#FFFFFF", paddingHorizontal: 16, paddingTop: Platform.OS === "ios" ? 16 : 12,

    },
    backBtn: {
        width: 36, height: 36, borderRadius: 18,
        backgroundColor: "#0fb760ff", alignItems: "center", justifyContent: "center",
    },
    headerTitle: { fontSize: 18, fontWeight: "700", color: "#111827", letterSpacing: -0.3 },
    headerCountPill: {
        minWidth: 32, height: 28, paddingHorizontal: 10, borderRadius: 14,
        backgroundColor: "#F3F4F6", alignItems: "center", justifyContent: "center",
    },
    headerCountText: { fontSize: 13, fontWeight: "700", color: "#4B5563" },

    searchSection: {
        backgroundColor: "#FFFFFF",
        paddingBottom: 12,
        borderBottomWidth: 1,
        borderBottomColor: "#F3F4F6",
    },
    searchWrap: {
        flexDirection: "row", alignItems: "center", gap: 8,
        backgroundColor: "#f1f1f4ff", borderRadius: 20,
        marginHorizontal: 16, marginTop: 12,
        paddingHorizontal: 14, paddingVertical: Platform.OS === "ios" ? 12 : 10,
        marginBottom: 8,
    },
    searchInput: {
        flex: 1, fontSize: 15, color: "#111827",
        ...(Platform.OS === "web" && { outlineStyle: "none" } as any),
    },

    filterRow: {
        flexDirection: "row", alignItems: "center", justifyContent: "space-between",
        paddingHorizontal: 16, paddingTop: 8,
    },
    filterPillGroup: { flexDirection: "row", gap: 8 },
    filterTab: {
        paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
        backgroundColor: "#FFFFFF",
        borderWidth: 1, borderColor: "#E5E7EB",
    },
    filterTabActive: { backgroundColor: "#1F9F4E", borderColor: "#1F9F4E" },
    filterTabText: { fontSize: 13, fontWeight: "600", color: "#6B7280" },
    filterTabTextActive: { color: "#FFFFFF" },

    liveBadge: {
        flexDirection: "row", alignItems: "center", gap: 6,
        paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20,
        backgroundColor: "#DEF7EC",
    },
    liveBadgeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#046C4E" },
    liveBadgeText: { fontSize: 12, fontWeight: "700", color: "#046C4E" },

    scroll: { flex: 1, backgroundColor: "#dde4d8ff" },
    scrollContent: { paddingHorizontal: 10, paddingTop: 10, paddingBottom: 20, gap: 6 },
    scrollEmpty: { flex: 1 },

    emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 80, gap: 16 },
    emptyIconWrap: {
        width: 80, height: 80, borderRadius: 40, backgroundColor: "#F3F4F6",
        alignItems: "center", justifyContent: "center",
    },
    emptyTitle: { fontSize: 18, fontWeight: "700", color: "#111827" },
    emptyDesc: { fontSize: 14, color: "#6B7280", textAlign: "center", paddingHorizontal: 40, lineHeight: 20 },

    // Creator Group Card
    groupCard: {
        backgroundColor: "#FFFFFF",
        borderRadius: 16,
        borderWidth: 1,
        borderColor: "#E5E7EB",
        overflow: "hidden",
    },
    creatorHeader: {
        flexDirection: "row", alignItems: "center", gap: 12,
        paddingHorizontal: 16, paddingVertical: 14,
        backgroundColor: "#FFFFFF",
    },
    creatorAvatar: {
        width: 40, height: 40, borderRadius: 20,
        alignItems: "center", justifyContent: "center"
    },
    creatorAvatarText: { color: "#FFFFFF", fontWeight: "700", fontSize: 16 },
    creatorInfo: { flex: 1, justifyContent: "center" },
    creatorName: { fontSize: 15, fontWeight: "700", color: "#111827", marginBottom: 2 },
    creatorEmail: { fontSize: 13, color: "#6B7280" },

    creatorRight: { flexDirection: "row", alignItems: "center", gap: 10 },
    creatorPollCount: {
        fontSize: 13, fontWeight: "600", color: "#4B5563",
        backgroundColor: "#F3F4F6", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12,
    },
    miniLiveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#10B981" },

    pollsWrap: {
        paddingHorizontal: 12, paddingBottom: 12, gap: 8, backgroundColor: "#FFFFFF",
        borderTopWidth: 1, borderTopColor: "#F3F4F6", paddingTop: 12
    },

    // Poll Card Layout
    pollCard: {
        backgroundColor: "#FFFFFF",
        borderRadius: 12,
        padding: 14,
        borderWidth: 1,
        borderColor: "#E5E7EB",
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.03,
        shadowRadius: 2,
        elevation: 1,
    },

    pollTopSection: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 12,
        marginBottom: 12,
    },

    pollLogo: {
        width: 52,
        height: 52,
        borderRadius: 8,
        backgroundColor: "#F3F4F6",
        borderWidth: 1,
        borderColor: "#E5E7EB",
    },
    pollLogoPlaceholder: {
        width: 52,
        height: 52,
        borderRadius: 8,
        backgroundColor: "#F3F4F6",
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1,
        borderColor: "#E5E7EB",
    },

    pollDetailsBody: {
        flex: 1,
        gap: 6,
    },

    pollHeader: {
        flexDirection: "row",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 12,
    },
    pollTitle: { flex: 1, fontSize: 15, fontWeight: "600", color: "#111827", lineHeight: 20 },

    statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, flexShrink: 0 },
    badgeActive: { backgroundColor: "#DEF7EC" },
    badgeClosed: { backgroundColor: "#F3F4F6" },
    badgeText: { fontSize: 12, fontWeight: "700" },
    badgeTextActive: { color: "#046C4E" },
    badgeTextClosed: { color: "#6B7280" },

    pollMetaRow: {
        flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8,
        marginTop: 2,
    },
    metaIconGroup: { flexDirection: "row", alignItems: "center", gap: 4 },
    metaText: { fontSize: 13, color: "#6B7280", fontWeight: "500" },
    metaDivider: { width: 4, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB" },

    pollFooter: {
        flexDirection: "row", alignItems: "center", justifyContent: "space-between",
        borderTopWidth: 1, borderTopColor: "#F3F4F6", paddingTop: 12,
    },
    badgeGroup: { flexDirection: "row", alignItems: "center", gap: 8 },

    // Tag styles
    tagStandard: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: "#F3F4F6" },
    tagTextStandard: { fontSize: 12, color: "#4B5563", fontWeight: "600" },

    tagVIP: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: "#FEF3C7" },
    tagTextVIP: { fontSize: 12, color: "#B45309", fontWeight: "600" },

    tagVerified: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: "#ECFDF5" },
    tagTextVerified: { fontSize: 12, color: "#047857", fontWeight: "600" },

    tagUnverified: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: "#FEF2F2" },
    tagTextUnverified: { fontSize: 12, color: "#B91C1C", fontWeight: "600" },
});