import React, { useState, useEffect, useCallback, useContext } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Image,
} from "react-native";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { GlobalContext } from "@/context";
import ReusableScreen from "@/components/ReusableScreen";
import AsyncStorage from "@react-native-async-storage/async-storage";

import * as Updates from "expo-updates";
import { UserStorageKeys } from "@/hooks/storageKeys";

//const SERVER_URL = "https://email-service-405496305969.us-central1.run.app";
const SERVER_URL = "https://email-service-570014654568.us-central1.run.app";

type Params = {
  username?: string;
  email?: string;
  password?: string;
};

export default function VerificationScreen() {
  const router = useRouter();
  const {
    userId, setTraditionalAuth
  } = useContext(GlobalContext);

  const { username, email, password } = useLocalSearchParams<Params>();

  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [countdown, setCountdown] = useState(180);

  // --- Redirect if already logged in ---
  /*  useFocusEffect(
     useCallback(() => {
       if (userId) router.replace("/");
     }, [userId])
   ); */

  // --- Clear messages when code changes ---
  useEffect(() => {
    setError("");
    setSuccess("");
  }, [code]);

  // --- Countdown timer ---
  useEffect(() => {
    if (countdown <= 0) return;

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [countdown]);

  // --- Verify code ---
  const verifyCode = async () => {
    if (!code.trim()) {
      setError("Please enter the verification code");
      return;
    }

    if (!email || !username || !password) {
      setError("Missing registration details");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch(`${SERVER_URL}/verify-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code, password }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data?.error || "Invalid code, please try again");
        return;
      }

      // --- Build user object ---
      const userObj = {
        email,
        name: username,
        password,
        picture: null,
      };

      await fetch(`${SERVER_URL}/push_notification`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: "New user added",
          body: email || "Unknown email",
          data: {
            screen: "chat/members_list",
            commentId: 0, // MUST be string
          },
        }),
      });

      // --- Update global auth state ---
      setTraditionalAuth(userObj);

      // --- Persist credentials (mobile + web) ---
      const storageKey = UserStorageKeys.savedUserCredentials();

      try {
        if (Platform.OS === "web") {
          if (typeof window !== "undefined") {
            window.localStorage.setItem(storageKey, JSON.stringify(userObj));
          }
        } else {
          await AsyncStorage.setItem(storageKey, JSON.stringify(userObj));
        }
      } catch (storageError) {
        console.error("Error saving user credentials:", storageError);
      }

      // --- UI success state ---
      setSuccess("Verification successful!");
      setCountdown(0);

      // --- Navigation ---
      router.replace("/chat/welcome");

      // --- Hard redirect for web (ensures fresh auth state) ---
      if (Platform.OS === "web" && typeof window !== "undefined") {
        setTimeout(() => {
          window.location.replace("/");
        }, 50);

      }

    } catch (err) {
      console.error(err);
      setError("Network error, please try again");
    } finally {
      setLoading(false);
    }
  }

  // --- Resend code ---
  const resendCode = async () => {
    if (!email || !username || !password) return;

    setError("");
    setLoading(true);

    try {
      const res = await fetch(`${SERVER_URL}/send-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, email, password }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setSuccess("A new verification code has been sent!");
        setCountdown(180);
      } else {
        setError(data.error || "Failed to resend code");
      }
    } catch {
      setError("Network error, you may use the Google sign-in option");
    } finally {
      setLoading(false);
    }
  };

  // --- Cancel verification ---
  const cancelEmailVerification = async () => {

    // if (!email) return;

    setLoading(true);
    try {
      if (email) {
        const res = await fetch(`${SERVER_URL}/cancel-email-verification`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });

        const data = await res.json();

        if (!res.ok || !data.success) {
          setError(data.error || "Failed to cancel verification");
        }
        setCountdown(0);


      }


    } catch {
      setError("Cancellation failed, network error");
    } finally {
      setLoading(false);
      router.replace("/");
      if (Platform.OS === "web" && typeof window !== "undefined") {
        window.location.replace("/");
      }
    }


  };

  const formatTime = (sec: number) =>
    `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;

  return (
    <ReusableScreen>
      <View style={styles.container}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.scrollContainer}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.logoContainer}>
              <Image
                source={require("@/assets/images/LOGO.png")}
                style={{ width: 70, height: 70 }}
              />
              <Text style={styles.appName}>Smart People</Text>
            </View>

            <View style={{ gap: 2, alignItems: "center", marginBottom: 20, flexDirection: "column" }}>

              <View style={{ flexDirection: "column", marginBottom: 20, alignItems: "center", }}>
                <View></View><Text style={styles.title}>Verify Your Email</Text>
                <Text style={styles.subtitle}>Wait for the short code...</Text>
              </View>
              <View style={{ flexDirection: "column", alignItems: "center", borderWidth: 1, borderColor: "green", paddingHorizontal: 25, paddingVertical: 20 }}>
                <Text style={styles.enterCodeSent}>Enter the code sent to</Text>
                <Text style={{ fontWeight: "bold" }}>{email}</Text>
              </View>

            </View>

            <View style={styles.inputWrapper}>
              <Ionicons name="key-outline" size={20} color="#666" />
              <TextInput
                style={styles.input}
                placeholder="Verification Code"
                value={code}
                onChangeText={setCode}
                keyboardType="number-pad"
                editable={!loading}
                maxLength={30}
              />
            </View>


            <View style={{
            }}>
              {countdown > 0 ? (
                <TouchableOpacity
                  style={[styles.button, loading && styles.buttonDisabled]}
                  onPress={verifyCode}
                  disabled={loading}
                >
                  {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Verify</Text>}
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[styles.button, { backgroundColor: "#3FAE5Cff" }]}
                  onPress={resendCode}
                  disabled={loading}
                >
                  {loading ? <ActivityIndicator color="#fff" /> : <Text style={[styles.buttonText, { color: "#fff" }]}>Resend Code</Text>}
                </TouchableOpacity>
              )}
            </View>

            {countdown > 0 && (
              <Text style={styles.timerText}>Resend in {formatTime(countdown)}</Text>
            )}

            {error ? <Text style={styles.error}>1{error}</Text> : null}
            {success ? <Text style={styles.success}>2{success}</Text> : null}

            <TouchableOpacity
              style={{ marginBottom: 20 }}
              onPress={cancelEmailVerification}
            >
              <Text style={styles.cancelText}>Cancel email verification</Text>
            </TouchableOpacity>

            <View style={styles.footerSection}>
              <Text style={styles.footerText}>© 2025 Smart People</Text>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </ReusableScreen>
  );
}


const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#eef8f1ff",
    paddingHorizontal: 20,
    justifyContent: "center",
  },
  scrollContainer: {
    flexGrow: 1,
    justifyContent: "center",
    paddingVertical: 40,
  },
  logoContainer: {
    alignItems: "center",
    marginBottom: 30,
  },
  appName: {
    fontSize: 30,
    fontWeight: "bold",
    color: "#17A34A",
    marginTop: 15,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 8,
    color: "#4caf50",
  },
  subtitle: {
    fontSize: 16,
    textAlign: "center",
    marginBottom: 5,
    color: "#17a31cff",
  },

  enterCodeSent: {
    fontSize: 18,
    textAlign: "center",
    marginBottom: 5,
    fontWeight: "800",
    color: "#1E9E4Aff",
  },
  inputWrapper: {
    flexDirection: "row",
    backgroundColor: "#fff",
    borderRadius: 30,
    paddingHorizontal: 15,
    marginBottom: 10,
    alignItems: "center",
    alignSelf: "center",
    marginHorizontal: 40,
    height: 50,
    borderWidth: 2,
    borderColor: "#cdebd7ff",
    shadowColor: "#fff",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  input: {
    flex: 1,
    fontSize: 16,
    paddingHorizontal: 10,
    color: "#666",
    ...(Platform.OS === "web" && {
      outlineStyle: "none",
      outlineWidth: 0,
      boxShadow: "none",
    }),
  },
  button: {
    backgroundColor: "#4caf50",
    paddingVertical: 12,
    borderRadius: 30,
    alignItems: "center",
    marginBottom: 15,
    shadowColor: "#fff",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
    elevation: 3, alignSelf: "center", paddingHorizontal: 55,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
  },
  timerText: {
    textAlign: "center",
    fontSize: 15,
    color: "#777",
    marginBottom: 10,
  },
  error: {
    color: "#e53935",
    fontWeight: "600",
    textAlign: "center",
    marginVertical: 8,
    fontSize: 15,
  },
  success: {
    color: "#43a047",
    fontWeight: "600",
    textAlign: "center",
    marginVertical: 8,
    fontSize: 15,
  },
  cancelText: {
    textDecorationLine: "underline",
    fontWeight: "800",
    color: "#4f3636ff",
    textAlign: "center",
    fontSize: 16,
    marginTop: 20,
  },
  footerSection: {
    alignItems: "center",
    marginTop: 6,
  },

  footerText: {
    textAlign: "center",
    color: "#78350F",
    fontSize: 13,
    marginTop: 4,
  },
  termsAndConditions: {
    marginTop: 10,
    fontSize: 13,
    fontWeight: "700",
    color: "#17A34A",
  },
});