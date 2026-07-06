import React, { useCallback, useContext, useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  ScrollView,
  Platform,
  Image
} from "react-native";
import { MaterialCommunityIcons, Ionicons, AntDesign } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "@/context/auth";
import ReusableScreen from "@/components/ReusableScreen";
import { GlobalContext } from "@/context";
import { doc, getDoc, } from "firebase/firestore";
import { db } from "@/firebase";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { UserStorageKeys } from "@/hooks/storageKeys";

export default function LoginScreen() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [secure, setSecure] = useState(true);
  const [loading, setLoading] = useState(false);

  const {
    signIn, isLoading,
    userId, setTraditionalAuth
  } = useContext(GlobalContext);

  // --- Auto-navigate if user exists ---

  useFocusEffect(
    useCallback(() => {
      if (userId) router.replace("/");
    }, [userId])
  );

  const signInHandle = async () => {
    setLoading(true);
    try {
      await signIn();
    } catch (err: any) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  const loginHandler = async () => {
    if (loading) return;

    if (!email || !password) {
      setError("Email and password are required");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const emailKey = email.trim().toLowerCase();
      const userRef = doc(db, "members_list_db", emailKey);
      const userSnap = await getDoc(userRef);

      if (!userSnap.exists()) {
        setError("Account not found");
        return;
      }

      const userData = userSnap.data();

      if (userData.userPassword !== password) {
        setError("Invalid email / password");
        return;
      }
      setError("Sucess!");
      const userObj = {
        email: emailKey,
        name: userData.clientName ?? "",
        password,
        picture: userData.picture ?? null,
      };
      setTraditionalAuth(userObj)

      const savedUserCredentials = async () => {
        try {
          if (Platform.OS === "web") {
            if (typeof window !== "undefined") {
              window.localStorage.setItem(UserStorageKeys.savedUserCredentials(), JSON.stringify(userObj));
            }
          } else {
            await AsyncStorage.setItem(UserStorageKeys.savedUserCredentials(), JSON.stringify(userObj));
          }
        } catch (storageError) {
          console.error("Error saving user credentials:", storageError);
        }
      };
      savedUserCredentials();

      //Navigate
      router.replace("/");

      //Web hard refresh (optional)
      if (Platform.OS === "web") {
        setTimeout(() => {
          window.location.replace("/");
        }, 50);
      }

    } catch (err) {
      console.error("Login error:", err);
      setError("Login failed. Try again.");
    } finally {
      setLoading(false);
    }
  };



  if (isLoading) {
    return (
      <View style={styles.loaderContainer}>
        <ActivityIndicator size="large" color="#1E9E4A" />
      </View>
    );
  }
  return (
    <ReusableScreen>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.container}>
          {/* HEADER */}
          <View style={styles.header}>
            <Image source={require("@/assets/images/LOGO.png")} style={styles.logo} />

            <View>
              <Text style={styles.appTitle}>Smart People</Text>
            </View>
            <View style={{ flexDirection: "row", gap: 5, alignItems: "baseline" }}>
              <MaterialCommunityIcons name="signal-cellular-3" size={25} color="#1EA34D" />
              <Text style={styles.subtitle}>Sign In</Text>
            </View>

          </View>

          {/* INPUTS */}
          <View style={styles.formContainer}>
            <View style={[styles.inputWrapper]}>
              <MaterialCommunityIcons
                name="email-outline"
                size={22}
                color="#9CA3AF"
              />
              <TextInput
                style={styles.input}
                placeholder="Email Address"
                placeholderTextColor="#9CA3AF"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                maxLength={30}
              />
            </View>

            <View style={styles.inputWrapper}>
              <MaterialCommunityIcons name="lock-outline" size={22} color="#9CA3AF" />

              <TextInput
                style={[styles.input, { paddingRight: 45 }]} // reserve space
                placeholder="Password"
                placeholderTextColor="#9CA3AF"
                secureTextEntry={secure}
                value={password}
                onChangeText={setPassword}
                maxLength={30}
              />

              <TouchableOpacity
                style={styles.eyeButton}
                onPress={() => setSecure(!secure)}
              >
                <Ionicons
                  name={secure ? "eye-off-outline" : "eye-outline"}
                  size={22}
                  color="#9CA3AF"
                />
              </TouchableOpacity>
            </View>


            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            {/* LOGIN BUTTON */}
            <TouchableOpacity
              style={[styles.loginButton, loading && { opacity: 0.7 }]}
              onPress={loginHandler}
              disabled={loading}
            >
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.loginText}>Login</Text>}
            </TouchableOpacity>

            {/* REGISTER LINK */}
            <View style={styles.inlineContainer}>
              <Text style={styles.subText}>Don’t have an account?</Text>
              <TouchableOpacity onPress={() => router.navigate("./register")}>
                <Text style={styles.link}>Register</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* SOCIAL LOGIN */}

          <View style={styles.socialSection}>

            <Text style={styles.orText}>Or</Text>

            {/*  <View style={styles.socialRow}>
              <TouchableOpacity onPress={signInHandle} style={styles.socialButton}>
                <Text style={styles.socialLetter}>G</Text>
              </TouchableOpacity>

              <TouchableOpacity onPress={signInHandle} style={styles.socialButton}>
                <Text style={styles.socialLetterFacebook}>f</Text>
              </TouchableOpacity>

              <TouchableOpacity onPress={signInHandle} style={styles.socialButton}>
                <AntDesign name="apple1" size={24} color="#000" />
              </TouchableOpacity>
            </View> */}

            <View style={styles.socialRow}>
              <TouchableOpacity onPress={signInHandle} style={styles.socialButton}>
                <Image source={require("@/assets/images/google-icon.png")} style={styles.logoGoogle} /><Text style={{ fontSize: 16, color: "#000", fontWeight: "700" }}>Continue with Google</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.footerSection}>
              <Text style={styles.footerText}>© 2025 SmartPeople</Text>

              <TouchableOpacity
                onPress={() => router.push("./PrivacyPolicy&TermsOfUse")}
              >
                <Text style={styles.termsAndConditions}>
                  Terms and Conditions Apply
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </ReusableScreen>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: "center", padding: 20, backgroundColor: "#eef8f1ff" },
  loaderContainer: { flex: 1, justifyContent: "center", alignItems: "center" },
  header: { alignItems: "center", marginBottom: 5, gap: 10 },
  logo: { width: 70, height: 70 },
  logoGoogle: { width: 25, height: 25 },
  appTitle: { fontSize: 25, fontWeight: "800", color: "#17A34A", marginTop: 10 },
  subtitle: { fontSize: 22, color: "#1EA34D", fontWeight: "800" },
  formContainer: { marginVertical: 20, marginHorizontal: 5, },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 12,
    paddingHorizontal: 15,
    paddingVertical: 3,
    borderWidth: 1.5,
    borderColor: "#c3ecceff",
    marginBottom: 5,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 2,
  },
  input: {
    flex: 1, fontSize: 18, paddingHorizontal: 10,
    paddingVertical: 10,
    ...(Platform.OS === "web" && {
      outlineStyle: "none",
      outlineWidth: 0,
      boxShadow: "none",
    }),
    color: "#111827",
  },
  eyeButton: {
    position: "absolute",
    right: 15,
    height: "100%",
    justifyContent: "center",
  },

  errorText: { color: "#FF3B30", textAlign: "center", marginBottom: 10 },
  loginButton: { backgroundColor: "#22A35Dff", paddingVertical: 13, borderRadius: 10, alignItems: "center", marginBottom: 10, marginTop: 10 },
  loginText: { color: "#fff", fontSize: 18, fontWeight: "bold" },
  inlineContainer: { flexDirection: "row", justifyContent: "center", marginTop: 10, alignItems: "center" },
  subText: { fontSize: 17, marginRight: 5 },
  link: { fontSize: 18, color: "#17A34A", fontWeight: "bold" },


  socialSection: {
    // marginTop: 28,
  },
  orText: {
    textAlign: "center",
    color: "#78350F",
    fontSize: 18,
    fontWeight: "800",
    marginBottom: 10,
  },

  socialRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 22,
  },

  socialButton: {
    borderRadius: 50,
    paddingHorizontal: 30,
    paddingVertical: 13,
    backgroundColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#cdebd7ff",
    flexDirection: "row",
    gap: 6,

    // iOS shadow
    shadowColor: "#8b8c8cff",
    shadowOpacity: 0.25,
    shadowOffset: { width: 3, height: 2 },
    shadowRadius: 2,

    // Android shadow
    elevation: 5,
  },


  socialLetter: {
    fontSize: 29,
    fontWeight: "800",
    color: "#DB4437", // Google
  },

  socialLetterFacebook: {
    fontSize: 29,
    fontWeight: "800",
    color: "#1877F2",
  },

  footerSection: {
    alignItems: "center",
  },

  termsAndConditions: {
    marginTop: 10,
    fontSize: 13,
    fontWeight: "700",
    color: "#17A34A",
  },


  footerText: {
    textAlign: "center",
    color: "#78350F",
    fontSize: 13,
    marginTop: 4,
  },
});