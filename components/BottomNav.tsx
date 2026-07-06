// components/BottomNav.tsx
import React, { useContext, useMemo } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, usePathname } from "expo-router";
import { GlobalContext } from "@/context/index";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "@/context/auth";
import { useChatListListener } from "@/hooks/useChatListListener";

export default function BottomNav() {
  const {
    hasUnreadMessages, unreadCount, userId
  } = useContext(GlobalContext);


  const { contacts } = useChatListListener(userId);
  const pathname = usePathname();
  const { setClientName, setClientId } = useContext(GlobalContext);

  const isWeb = Platform.OS === "web";

  const { user } = useAuth();

  const isActive = (route: string) =>
    pathname.includes(route.replace("./", ""));
  const getColor = (route: string) =>
    isActive(route) ? "#099750" : "#333";

  const commentHandle = async () => {
    setClientName(user?.name || "Guest");
    setClientId(user?.sub,);

    if (isWeb) {
      sessionStorage.setItem("navigatedToChat", "true");
    } else {
      await AsyncStorage.setItem("navigatedToChat", "true");
    }

    router.navigate("./comments");
  };



  const unreadChatsCount = useMemo(() => contacts.filter((c) => c.unreadCount > 0).length, [contacts]);


  return (
    <View style={styles.bottomNav}>
      {/* Members */}
      {/*   <TouchableOpacity
        style={styles.navItem}
        onPress={() => router.navigate("./members_list")}
      >
        <Ionicons name="people" size={24} color={getColor("./members_list")} />
        <Text style={[styles.navText, { color: getColor("./members_list") }]}>
          Learners
        </Text>
      </TouchableOpacity> */}

      <TouchableOpacity
        style={[styles.navItem, {
          backgroundColor: "#fff", paddingHorizontal: 13
        }]}
        onPress={() => router.navigate("./userChatMessages")}
      >
        <View>
          <View style={{ position: "absolute", top: -5, right: -13, zIndex: 1 }}>
            <Text style={{}}>
              <View><Text style={{ position: "relative", right: 5, color: "#fff", backgroundColor: unreadChatsCount > 0 ? "#24a906ff" : "#bab8b8ff", paddingVertical: 1, paddingHorizontal: 4, borderRadius: 50 }}>{unreadChatsCount}</Text></View>
            </Text>
          </View>
          <View>
            <Ionicons
              name="chatbubbles-outline"
              size={24}
            />
            <Text style={[styles.navText]}>
              Chat
            </Text>
          </View>

        </View>

      </TouchableOpacity>


      <TouchableOpacity
        style={styles.navItem}
        onPress={() => commentHandle()}
      >
        <Ionicons
          name="chatbox-outline"
          size={24}
        />
        <Text style={[styles.navText]}>
          Comment
        </Text>
      </TouchableOpacity>



      {/* Activity */}
      <TouchableOpacity
        style={styles.navItem}
        onPress={() => router.navigate("./PollsListScreen")}
      >
        <Ionicons
          name="sync-outline"
          size={24}
        />
        <Text style={[styles.navText]}>
          View Polls
        </Text>
      </TouchableOpacity>

      {/* Logout */}
      <TouchableOpacity
        style={styles.navItem}
        onPress={() => router.navigate("./create_poll_screen")}
      >
        <Ionicons name="create-outline" size={24} color="#333" />
        <Text style={[styles.navText, { color: "#333" }]}>Create Poll</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  bottomNav: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingVertical: 10,
    borderTopWidth: 0.5,
    borderTopColor: "#ccc",
    backgroundColor: "#fff",
  },
  navItem: { alignItems: "center" },
  navText: { fontSize: 13, marginTop: 2, fontWeight: "600" },
});
