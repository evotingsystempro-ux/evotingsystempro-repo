import { GestureHandlerRootView } from "react-native-gesture-handler";
import "react-native-reanimated";

import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";

import React, { useEffect, useState } from "react"; // ✅ useState added
import { View, Text } from "react-native";           // ✅ for ErrorBoundary

import { AuthProvider } from "@/context/auth";
import GlobalState from "@/context";
import { MenuProvider } from "react-native-popup-menu";
import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";

SplashScreen.preventAutoHideAsync().catch(() => { });

// ✅ Catches silent JS crashes and shows the error on screen instead of blank white
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  componentDidCatch(error: Error) {
    this.setState({ error: error.message });
  }
  render() {
    if (this.state.error) {
      return (
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 20, backgroundColor: "#fff" }}>
          <Text style={{ color: "red", fontSize: 14, textAlign: "center" }}>
            {this.state.error}
          </Text>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function RootLayout() {
  const router = useRouter();
  const [appReady, setAppReady] = useState(false); // ✅ controls splash + render

  // ✅ Hide splash screen — was never being called before (main cause of blank screen)
  useEffect(() => {
    SplashScreen.hideAsync()
      .catch(() => { })
      .finally(() => setAppReady(true));
  }, []);

  // ✅ Only attach notification listener after app is ready
  useEffect(() => {
    if (!appReady) return;

    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data;

      if (data?.screen) {
        router.push({
          pathname: data.screen,
          params: {
            commentId: data.commentId ?? "",
            clientName: data.clientName ?? "",
            clientIconUri: data.clientIconUri ?? "",
            clientEmail: data.clientEmail ?? "",
          },
        });
      }
    });

    return () => sub.remove();
  }, [appReady]);

  // ✅ Don't render anything until splash is hidden
  if (!appReady) return null;

  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}> {/* ✅ flex:1 added */}
        <AuthProvider>
          <GlobalState>
            <MenuProvider>
              <StatusBar style="light" backgroundColor="#1F9F4E" translucent={false} />
              <Stack
                screenOptions={{
                  headerShown: false,
                  headerShadowVisible: true,
                  animation: "none",
                  headerTitle: "",
                  headerTitleStyle: {
                    color: "#ffffff",
                    fontSize: 18,
                    fontWeight: "700",
                  },
                  statusBarBackgroundColor: "#31910bff",
                  statusBarStyle: "light",
                  headerTintColor: "#ffffff",
                  navigationBarColor: "#ffffff",
                }}
              >
                <Stack.Screen name="index" options={{ headerShown: false }} />
                <Stack.Screen name="loginHome" options={{ headerShown: false }} />
                <Stack.Screen name="chat/welcome" options={{ headerShown: false }} />
                <Stack.Screen name="login" options={{ headerShown: false }} />
                <Stack.Screen name="register" options={{ headerShown: false }} />
                <Stack.Screen name="chat/members_list" options={{ headerShown: false }} />
                <Stack.Screen name="chat/comments" options={{ headerShown: false }} />
                <Stack.Screen name="chat/buy_reset_credit_screen" options={{ headerShown: false }} />
                <Stack.Screen name="chat/admin_reset_credit_transaction_screen" options={{ headerShown: false }} />
                <Stack.Screen name="chat/UserTransactionScreen" options={{ headerShown: false }} />
                <Stack.Screen name="chat/profile" options={{ headerShown: false }} />
                <Stack.Screen name="chat/create_poll_screen" options={{ headerShown: false }} />
                <Stack.Screen name="chat/PollsListScreen" options={{ headerShown: false }} />
                <Stack.Screen name="chat/poll_leaderboard" options={{ headerShown: false }} />
                <Stack.Screen name="chat/userChatMessages" options={{ headerShown: false }} />
                <Stack.Screen name="PrivacyPolicy&TermsOfUse" options={{ headerShown: false }} />
              </Stack>
            </MenuProvider>
          </GlobalState>
        </AuthProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}