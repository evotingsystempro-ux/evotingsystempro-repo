//register.tsx
import React, { useState, useEffect, useContext, useCallback } from "react";
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
  Image,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import {
  MaterialCommunityIcons,
  Ionicons,
  AntDesign,
} from "@expo/vector-icons";
import ReusableScreen from "@/components/ReusableScreen";
import { GlobalContext } from "@/context";

//const SERVER_URL = "http://10.15.20.68:8080";
const SERVER_URL = "https://email-service-570014654568.us-central1.run.app";

export default function RegisterScreen() {
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [secure, setSecure] = useState(true);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const {
    signIn, userName
  } = useContext(GlobalContext);

  /** Redirect if logged in */
  useFocusEffect(
    useCallback(() => {
      if (userName) router.replace("/");
    }, [userName])
  );

  // DO NOT TOUCH LOGIC
  useEffect(() => {
    if (error || success) {
      setError("");
      setSuccess("");
    }
  }, [username, email, password]);

  const sendCode = async () => {
    if (!username.trim() || !email.trim() || !password.trim()) {
      setError("Please fill all fields");
      return;
    }

    setLoading(true);
    /*  try {
          const res = await fetch(`${SERVER_URL}/send-code`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, email, password }),
          });
          const data = await res.json();
    
          if (res.ok && data.success) {
            setSuccess("Verification code sent!");
            router.replace({
              pathname: "./VerificationScreen",
              params: { username, email, password },
            });
          } else {
            setError(data.error || "Failed to send code");
          }
        } catch {
          setError("Network error, please try again");
        } finally {
          setLoading(false);
        } */

    try {
      const res = await fetch(`${SERVER_URL}/send-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, email, password }),
      });

      const text = await res.text(); // read raw response
      console.log("Raw response:", text);

      const data = JSON.parse(text); // parse manually
      if (res.ok && data.success) {
        setSuccess("Verification code sent!");
        router.replace({
          pathname: "./VerificationScreen",
          params: { username, email, password },
        });
      } else {
        setError(data.error || "Failed to send code");
      }
    } catch (err) {
      console.log("Fetch error:", err);
      setError("Network error, you may use the google sign-in option");
    } finally {
      setLoading(false);
    }

  };

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

  return (
    <ReusableScreen>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.container}>
          {/* HEADER */}
          <View style={{ alignItems: "center", marginBottom: 15, }}>
            <View style={styles.logoContainer}>
              <Image
                source={require("@/assets/images/LOGO.png")}
                style={{ width: 65, height: 65 }}
              />
            </View>
            <View style={{ marginBottom: 15 }}>
              <Text style={styles.appTitle}>Smart People</Text>
            </View>
            <View style={{ flexDirection: "row", gap: 5, alignItems: "center" }}>
              <MaterialCommunityIcons name="account-circle" size={35} color="#1EA34D" />
              <Text style={styles.subtitle}>Create your account</Text>
            </View>
          </View>

          {/* FORM */}
          <View style={styles.formContainer}>
            {/* Username */}
            <View style={styles.inputWrapper}>
              <MaterialCommunityIcons
                name="account-outline"
                size={22}
                color="#9CA3AF"
              />
              <TextInput
                style={styles.input}
                placeholder="Username"
                placeholderTextColor="#9CA3AF"
                value={username}
                onChangeText={setUsername}
                autoCapitalize="none"
                maxLength={30}
              />
            </View>

            {/* Email */}
            <View style={styles.inputWrapper}>
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

            {/* Password */}
            <View style={styles.inputWrapper}>
              <MaterialCommunityIcons
                name="lock-outline"
                size={22}
                color="#9CA3AF"
              />

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
                  size={20}
                  color="#9CA3AF"
                />
              </TouchableOpacity>
            </View>


            {/* Messages */}
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            {success ? <Text style={styles.successText}>{success}</Text> : null}

            {/* REGISTER BUTTON */}
            <TouchableOpacity
              style={[styles.registerButton, loading && { opacity: 0.7 }]}
              onPress={sendCode}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.registerText}>Register</Text>
              )}
            </TouchableOpacity>

            {/* LOGIN LINK */}
            <View style={styles.inlineContainer}>
              <Text style={styles.subText}>Already have an account?</Text>
              <TouchableOpacity onPress={() => router.back()}>
                <Text style={styles.link}>Login</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.socialSection}>
              <Text style={styles.orText}>Or</Text>

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

          </View>

        </ScrollView>
      </KeyboardAvoidingView>
    </ReusableScreen>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    justifyContent: "center",
    padding: 24,
    backgroundColor: "#eef8f1ff",
  },

  logoGoogle: { width: 25, height: 25 },
  logoContainer: {
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "green",
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 4,
    elevation: 4,
  },
  appTitle: {
    fontSize: 25,
    fontWeight: "800",
    color: "#17A34A",
    marginTop: 15,
  },
  subtitle: {
    color: "#1EA34D",
    fontSize: 20,
    marginTop: 4,
    textAlign: "center", fontWeight: "800"
  },
  formContainer: {
    marginHorizontal: 5,
  },
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
    flex: 1,
    marginRight: 5, fontSize: 18, paddingLeft: 10, paddingVertical: 10,
    ...(Platform.OS === "web" && {
      outlineStyle: "none",
      outlineWidth: 0,
      boxShadow: "none",
    }),
    color: "#111827",
  },
  errorText: {
    color: "#DC2626",
    textAlign: "center",
    marginBottom: 10,
    fontWeight: "600",
    fontSize: 15,
    width: "80%",
    alignSelf: "center",
  },
  successText: {
    color: "#16A34A",
    textAlign: "center",
    marginBottom: 10,
    fontWeight: "600",
  },
  registerButton: {
    backgroundColor: "#22A35Dff",
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 10,
    shadowColor: "#15803D",
    shadowOpacity: 0.25,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
  },
  registerText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 18,
  },
  inlineContainer: {
    flexDirection: "row",
    justifyContent: "center",
    marginTop: 15, alignItems: "center"
  },
  subText: { fontSize: 17, color: "#78350F" },
  link: {
    color: "#17A34A",
    fontWeight: "700",
    marginLeft: 6, fontSize: 18,
  },
  footerText: {
    textAlign: "center",
    color: "#78350F",
    fontSize: 13,
    marginTop: 4,
  },

  socialSection: {
    marginTop: 10,
  },

  orText: {
    textAlign: "center",
    color: "#78350F",
    fontSize: 18,
    fontWeight: "800",
    marginBottom: 14,
  },

  socialRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 14,
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
    marginTop: 6,
  },

  termsAndConditions: {
    marginTop: 10,
    fontSize: 13,
    fontWeight: "700",
    color: "#17A34A",
  },
  eyeButton: {
    position: "absolute",
    right: 15,
    height: "100%",
    justifyContent: "center",
  },


});