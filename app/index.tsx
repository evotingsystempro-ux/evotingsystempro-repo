//index.tsx
import React, { useContext, useEffect, useRef } from "react";
import { View, Text, StyleSheet, Animated } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { GlobalContext } from "@/context";

export default function IndexScreen() {
  const router = useRouter();
  const { isLoading, userId } = useContext(GlobalContext);

  const fadeAnim = useRef(new Animated.Value(1)).current;
  const scaleAnim = useRef(new Animated.Value(0.5)).current;
  const hasNavigated = useRef(false); // ✅ prevents double navigation

  const navigate = () => {
    if (hasNavigated.current) return;
    hasNavigated.current = true;
    if (!userId) {
      router.replace("/loginHome");
    } else {
      router.replace("/chat/welcome");
    }
  };

  // ── Entrance animation (runs once on mount) ──
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        tension: 10,
        friction: 1,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  // ── Navigate when loading is done ──
  useEffect(() => {
    if (isLoading) return;

    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 600,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) return;
      navigate();
    });
  }, [isLoading, userId]);

  // ── Safety timeout fallback (in case isLoading gets stuck in production) ──
  useEffect(() => {
    const timeout = setTimeout(() => {
      navigate();
    }, 6000); // 6 seconds max wait

    return () => clearTimeout(timeout);
  }, [userId]);

  return (
    <View style={styles.container}>
      <Animated.View
        style={[
          styles.iconContainer,
          {
            opacity: fadeAnim,
            transform: [{ scale: scaleAnim }],
          },
        ]}
      >
        <Ionicons name="shield-checkmark-sharp" size={120} color="#2eae34ff" />
        <Text style={styles.appName}>Loading App...</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#eef5f0",
    alignItems: "center",
    justifyContent: "center",
  },
  iconContainer: {
    alignItems: "center",
  },
  appName: {
    color: "#28a245ff",
    fontSize: 32,
    fontWeight: "bold",
    marginTop: 20,
    letterSpacing: 1,
    textAlign: "center",
  },
});