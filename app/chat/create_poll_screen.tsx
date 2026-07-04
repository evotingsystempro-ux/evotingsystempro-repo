import React, { useContext, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Platform,
  KeyboardAvoidingView,
  Switch,
  ActivityIndicator,
  Alert,
  Image,
} from "react-native";
import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system";
import * as DocumentPicker from "expo-document-picker";
import * as XLSX from "xlsx";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import DateTimePicker from "@react-native-community/datetimepicker";
import ReusableScreen from "@/components/ReusableScreen";
import { GlobalContext } from "@/context";
import { db, storage } from "@/firebase";
import { doc, setDoc, getDoc, serverTimestamp } from "firebase/firestore";
import { ref, uploadBytes, uploadString, getDownloadURL } from "firebase/storage";

// ─── Types ────────────────────────────────────────────────────────────────────

type PollType = "single" | "multiple";
type VoterValidationMode = "manual" | "file";

interface Aspirant {
  id: string;
  name: string;
  email: string;
  photoUri: string | null; // local preview uri, once picked
  photoUrl: string | null; // uploaded download url, once uploaded
  uploadingPhoto: boolean;
}

interface ManualVoterEntry {
  id: string;
  name: string;
  email: string;
}

interface ParsedVoter {
  name: string;
  email: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const generatePollId = () =>
  `POLL_${Date.now()}_${Math.random()
    .toString(36)
    .substring(2, 7)
    .toUpperCase()}`;

const isValidEmail = (email: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

const pad2 = (n: number) => n.toString().padStart(2, "0");
const toDateInputValue = (d: Date) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const toTimeInputValue = (d: Date) =>
  `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

const AVATAR_PALETTE = ["#1F9F4E", "#2563EB", "#D97706", "#7C3AED", "#DB2777", "#0D9488", "#DC2626", "#0891B2"];

// Resolves a file extension + content type for a picked image asset.
const resolveImageMeta = (uri: string, mimeTypeFromPicker?: string) => {
  const rawExt = uri.split(".").pop()?.split("?")[0]?.toLowerCase();
  const knownExts = ["jpg", "jpeg", "png", "webp", "heic", "gif"];
  const ext = rawExt && knownExts.includes(rawExt) ? rawExt : "jpg";
  const contentType =
    mimeTypeFromPicker || `image/${ext === "jpg" ? "jpeg" : ext}`;
  return { ext, contentType };
};

const MAX_IMAGE_KB = 100; // any uploaded image (logo, aspirant photo, ...) targets this file-size cap
const MAX_IMAGE_BYTES = MAX_IMAGE_KB * 1024;

// Reads a picked image's file size in bytes, cross-platform:
// - Uses the picker's own reported size first when available (fast path,
//   no extra I/O).
// - Falls back to expo-file-system on iOS/Android.
// - Falls back to fetch + blob.size on web, since expo-file-system can't
//   read blob: URIs there and the picker doesn't reliably report fileSize
//   on web either.
const getImageByteSize = async (uri: string, knownBytes?: number): Promise<number> => {
  if (knownBytes) return knownBytes;

  if (Platform.OS === "web") {
    try {
      const blob = await (await fetch(uri)).blob();
      return blob.size;
    } catch {
      return 0;
    }
  }

  try {
    const info = await FileSystem.getInfoAsync(uri, { size: true });
    return (info.exists && "size" in info && info.size) || 0;
  } catch {
    return 0;
  }
};

// Checks a picked image's FILE SIZE (KB) — not pixel dimensions — and, if
// it's over maxBytes, proportionally shrinks the image toward that cap.
//
// File size roughly scales with pixel AREA (width × height) rather than a
// single linear dimension, so the byte ratio we need to shave off is
// applied to width/height as its SQUARE ROOT (area = scale² × area) — e.g.
// a 400kb image capped at 100kb needs ~25% of its bytes, so each side is
// scaled to sqrt(0.25) = 50%, roughly quartering the pixel area and, with
// it, the file size.
//
// This is a single-pass estimate rather than a byte-exact guarantee — JPEG
// output size also depends on image content/compression — but it reliably
// lands oversized images in the right ballpark on every platform, since
// expo-image-manipulator backs onto native resize APIs on iOS/Android and
// an in-browser canvas on web (no platform branching needed here).
const compressToTargetSize = async (
  uri: string,
  width: number,
  height: number,
  maxBytes: number,
  knownBytes?: number
): Promise<{ uri: string; wasResized: boolean; scalePercent: number }> => {
  const originalBytes = await getImageByteSize(uri, knownBytes);

  if (!originalBytes || originalBytes <= maxBytes) {
    return { uri, wasResized: false, scalePercent: 100 };
  }

  const byteRatio = maxBytes / originalBytes; // e.g. 0.25 = need ~25% of the original bytes
  const linearScale = Math.sqrt(byteRatio); // scale applied to width/height
  const target = {
    width: Math.max(1, Math.round((width || 1) * linearScale)),
    height: Math.max(1, Math.round((height || 1) * linearScale)),
  };

  const manipulated = await manipulateAsync(
    uri,
    [{ resize: target }],
    { compress: 0.8, format: SaveFormat.JPEG }
  );

  return {
    uri: manipulated.uri,
    wasResized: true,
    scalePercent: Math.round(linearScale * 100),
  };
};

// Used as the aspirant's "photo" value when no photo is uploaded — picks a
// random color from the same palette used for the numbered avatars, e.g. "#1F9F4E".
const getRandomAspirantColor = () =>
  AVATAR_PALETTE[Math.floor(Math.random() * AVATAR_PALETTE.length)];

const withTimeout = <T,>(promise: Promise<T>, ms = 20000): Promise<T> =>
  Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("Upload timed out")), ms)
    ),
  ]);

// Turns a free-form voter code into a safe Firestore document ID.
// Turns a voter's email into a safe Firestore document ID.
const sanitizeDocId = (rawEmail: string) => {
  const cleaned = rawEmail.trim().toLowerCase().replace(/\//g, "-").replace(/\s+/g, "");
  return cleaned.length ? cleaned : `VOTER_${Date.now()}`;
};

// Parses comma/tab-delimited text (.csv / .txt) into {name, code, email} rows.
const parseDelimitedVoters = (text: string): ParsedVoter[] => {
  const lines = text
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const rows = lines.map((line) => line.split(/\t|,/).map((c) => c.trim()));

  const dataRows =
    rows.length && rows[0][0] && /name/i.test(rows[0][0]) ? rows.slice(1) : rows;

  return dataRows
    .map((r) => ({ name: r[0] || "", email: r[1] || "" }))
    .filter((v) => v.name && v.email && isValidEmail(v.email));
};

// Parses an Excel workbook (base64-encoded .xlsx / .xls) into {name, code, email} rows.
const parseExcelVoters = (base64: string): ParsedVoter[] => {
  const workbook = XLSX.read(base64, { type: "base64" });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    blankrows: false,
  });

  const dataRows =
    rows.length && rows[0][0] && /name/i.test(String(rows[0][0]))
      ? rows.slice(1)
      : rows;

  return dataRows
    .map((r) => ({
      name: String(r[0] ?? "").trim(),
      email: String(r[1] ?? "").trim(),
    }))
    .filter((v) => v.name && v.email && isValidEmail(v.email));
};

// Reads a web blob: URI as base64 (expo-file-system doesn't support
// reading blob: URIs on web, so we go through FileReader instead).
const fetchUriAsBase64 = async (uri: string): Promise<string> => {
  const response = await fetch(uri);
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = (reader.result as string) || "";
      resolve(result.split(",")[1] || "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function CreatePollScreen() {
  const { userName, rawUserEmail } = useContext(GlobalContext);
  const scrollRef = React.useRef<ScrollView>(null);

  const [title, setTitle] = useState("");
  const [pollType, setPollType] = useState<PollType>("single");
  const [aspirants, setAspirants] = useState<Aspirant[]>([
    { id: "1", name: "", email: "", photoUri: null, photoUrl: null, uploadingPhoto: false },
    { id: "2", name: "", email: "", photoUri: null, photoUrl: null, uploadingPhoto: false },
  ]);
  const [deadline, setDeadline] = useState<Date | null>(null);
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [showResults, setShowResults] = useState(true);

  // ── Voter validation ────────────────────────────────────────────────────────
  // requiresVoterValidation === "requires_voters_validation" on the saved poll.
  // When true, only voters whose code exists under
  // VALIDATED_VOTERS_DB/{creatorEmail}/{pollId}/{code} may vote.
  const [requiresVoterValidation, setRequiresVoterValidation] = useState(false);
  const [voterValidationMode, setVoterValidationMode] = useState<VoterValidationMode>("manual");

  // Option 2: manual entry — dynamic name+code+email rows with a "+" to add more.
  const [manualVoters, setManualVoters] = useState<ManualVoterEntry[]>([
    { id: "1", name: "", email: "" },
  ]);

  // Option 1: file upload — CSV / Excel / Text, parsed cross-platform.
  const [uploadedVoters, setUploadedVoters] = useState<ParsedVoter[]>([]);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [parsingFile, setParsingFile] = useState(false);
  const [fileParseError, setFileParseError] = useState<string | null>(null);

  const [publishing, setPublishing] = useState(false);

  // Logo
  const [logoUri, setLogoUri] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string>("");
  const [uploadingLogo, setUploadingLogo] = useState(false);

  // Inline deadline picker
  const [showDeadlinePicker, setShowDeadlinePicker] = useState(false);
  const [pendingDate, setPendingDate] = useState<Date>(new Date());

  // Post-publish success state
  const [publishedTitle, setPublishedTitle] = useState<string | null>(null);

  // ── Aspirant helpers ────────────────────────────────────────────────────────

  const addAspirant = () => {
    if (aspirants.length >= 10) return;
    setAspirants((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        name: "",
        email: "",
        photoUri: null,
        photoUrl: null,
        uploadingPhoto: false,
      },
    ]);
  };

  const removeAspirant = (id: string) => {
    if (aspirants.length <= 2) return;
    setAspirants((prev) => prev.filter((a) => a.id !== id));
  };

  const updateAspirant = (id: string, field: "name" | "email", value: string) => {
    setAspirants((prev) =>
      prev.map((a) => (a.id === id ? { ...a, [field]: value } : a))
    );
  };

  // ── Aspirant photo (optional) ───────────────────────────────────────────────
  // If a creator skips this, handlePublish assigns a random color (e.g.
  // "#1F9F4E") as the aspirant's "photo" value instead of a URL.

  const pickAspirantPhoto = async (aspirantId: string) => {
    if (Platform.OS !== "web") {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Permission needed",
          "Please allow access to your photo library to add a photo."
        );
        return;
      }
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (result.canceled || !result.assets?.length) return;

    const asset = result.assets[0];
    setAspirants((prev) =>
      prev.map((a) =>
        a.id === aspirantId
          ? { ...a, photoUri: asset.uri, photoUrl: null, uploadingPhoto: true }
          : a
      )
    );

    try {
      let uploadUri = asset.uri;

      const { uri: resizedUri, wasResized, scalePercent } = await compressToTargetSize(
        asset.uri,
        asset.width,
        asset.height,
        MAX_IMAGE_BYTES,
        asset.fileSize
      );

      if (wasResized) {
        uploadUri = resizedUri;
        console.log(
          `Aspirant photo exceeded ${MAX_IMAGE_KB}kb — scaled to ~${scalePercent}% of its original dimensions.`
        );
        setAspirants((prev) =>
          prev.map((a) => (a.id === aspirantId ? { ...a, photoUri: resizedUri } : a))
        );
      }

      const { ext, contentType } = resolveImageMeta(
        uploadUri,
        uploadUri !== asset.uri ? "image/jpeg" : asset.mimeType
      );
      const storagePath = `aspirant_photos/${rawUserEmail}/${generatePollId()}_${aspirantId}.${ext}`;
      const storageRef = ref(storage, storagePath);

      if (Platform.OS === "web") {
        const response = await fetch(uploadUri);
        const blob = await response.blob();
        await withTimeout(uploadBytes(storageRef, blob, { contentType }));
      } else {
        const base64 = await FileSystem.readAsStringAsync(uploadUri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        await withTimeout(
          uploadString(storageRef, base64, "base64", { contentType })
        );
      }

      const downloadUrl = await getDownloadURL(storageRef);
      setAspirants((prev) =>
        prev.map((a) =>
          a.id === aspirantId
            ? { ...a, photoUrl: downloadUrl, uploadingPhoto: false }
            : a
        )
      );
    } catch (err) {
      console.error("Aspirant photo upload failed:", err);
      const timedOut = err instanceof Error && err.message === "Upload timed out";
      Alert.alert(
        "Upload failed",
        timedOut
          ? "Upload timed out. This can happen if Firebase Storage rules are blocking the write — please try again or contact support."
          : "Could not upload the photo. Please try again."
      );
      setAspirants((prev) =>
        prev.map((a) =>
          a.id === aspirantId
            ? { ...a, photoUri: null, photoUrl: null, uploadingPhoto: false }
            : a
        )
      );
    }
  };

  const removeAspirantPhoto = (aspirantId: string) => {
    setAspirants((prev) =>
      prev.map((a) =>
        a.id === aspirantId ? { ...a, photoUri: null, photoUrl: null } : a
      )
    );
  };

  // ── Voter validation helpers ────────────────────────────────────────────────

  const addManualVoter = () => {
    if (manualVoters.length >= 500) return;
    setManualVoters((prev) => [
      ...prev,
      { id: Date.now().toString(), name: "", email: "" },
    ]);
  };

  const removeManualVoter = (id: string) => {
    if (manualVoters.length <= 1) return;
    setManualVoters((prev) => prev.filter((v) => v.id !== id));
  };

  const updateManualVoter = (
    id: string,
    field: "name" | "email",
    value: string
  ) => {
    setManualVoters((prev) =>
      prev.map((v) => (v.id === id ? { ...v, [field]: value } : v))
    );
  };

  const clearUploadedFile = () => {
    setUploadedFileName(null);
    setUploadedVoters([]);
    setFileParseError(null);
  };

  // Cross-platform picker: works the same way on iOS, Android, and web.
  //
  // NOTE: strict MIME-type arrays (e.g. "text/csv") are unreliable across
  // Android OEMs — many file providers tag .csv/.xlsx files as
  // "application/octet-stream" or leave the type blank, which makes the
  // native picker silently show zero matching files (looks like "nothing
  // happens" when tapped). We ask for "*/*" instead and validate by file
  // extension after the fact, which works consistently on iOS, Android,
  // and web.
  //
  // The whole function is wrapped in try/catch: previously only the
  // parsing step was guarded, so if getDocumentAsync itself threw (e.g.
  // permission denial, or the native module not being linked yet after
  // installing expo-document-picker), the promise rejected with no visible
  // feedback at all — exactly the silent-failure symptom.
  const ALLOWED_VOTER_FILE_EXTS = ["csv", "txt", "xlsx", "xls"];

  const pickVoterFile = async () => {
    setFileParseError(null);

    let result: DocumentPicker.DocumentPickerResult;
    try {
      result = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        copyToCacheDirectory: true,
        multiple: false,
      });
    } catch (err) {
      console.error("Voter file picker failed to open:", err);
      setFileParseError(
        "Could not open the file picker. Please check app permissions and try again."
      );
      return;
    }

    if (result.canceled || !result.assets?.length) return;

    const asset = result.assets[0];
    const fileName = asset.name || "voters file";
    const ext = fileName.split(".").pop()?.toLowerCase() || "";

    if (!ALLOWED_VOTER_FILE_EXTS.includes(ext)) {
      setFileParseError(
        `"${fileName}" isn't a supported format. Please upload a .csv, .txt, .xlsx, or .xls file.`
      );
      return;
    }

    setParsingFile(true);
    setUploadedFileName(fileName);
    setUploadedVoters([]);

    try {
      let parsed: ParsedVoter[] = [];

      if (ext === "xlsx" || ext === "xls") {
        const base64 =
          Platform.OS === "web"
            ? await fetchUriAsBase64(asset.uri)
            : await FileSystem.readAsStringAsync(asset.uri, {
              encoding: FileSystem.EncodingType.Base64,
            });
        parsed = parseExcelVoters(base64);
      } else {
        // CSV or plain text
        const text =
          Platform.OS === "web"
            ? await (await fetch(asset.uri)).text()
            : await FileSystem.readAsStringAsync(asset.uri, {
              encoding: FileSystem.EncodingType.UTF8,
            });
        parsed = parseDelimitedVoters(text);
      }

      if (parsed.length === 0) {
        setFileParseError(
          "Each row needs a name, valid email or code separated by commas. e.g. `John Doe,johndoe@example.com`"
        );
      } else {
        setUploadedVoters(parsed);
      }
    } catch (err) {
      console.error("Voter file parse failed:", err);
      setFileParseError("Could not read this file. Please check the format and try again.");
    } finally {
      setParsingFile(false);
    }
  };

  // ── Logo picker ─────────────────────────────────────────────────────────────

  const pickLogo = async () => {
    if (Platform.OS !== "web") {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Permission needed",
          "Please allow access to your photo library to add a logo."
        );
        return;
      }
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });

    if (result.canceled || !result.assets?.length) return;

    const asset = result.assets[0];
    setLogoUri(asset.uri);
    setUploadingLogo(true);

    try {
      let uploadUri = asset.uri;

      const { uri: resizedUri, wasResized, scalePercent } = await compressToTargetSize(
        asset.uri,
        asset.width,
        asset.height,
        MAX_IMAGE_BYTES,
        asset.fileSize
      );

      if (wasResized) {
        uploadUri = resizedUri;
        console.log(
          `Logo exceeded ${MAX_IMAGE_KB}kb — scaled to ~${scalePercent}% of its original dimensions.`
        );
        setLogoUri(resizedUri);
      }

      const { ext, contentType } = resolveImageMeta(
        uploadUri,
        uploadUri !== asset.uri ? "image/jpeg" : asset.mimeType
      );
      const storagePath = `poll_logos/${rawUserEmail}/${generatePollId()}.${ext}`;
      const storageRef = ref(storage, storagePath);

      if (Platform.OS === "web") {
        const response = await fetch(uploadUri);
        const blob = await response.blob();
        await withTimeout(uploadBytes(storageRef, blob, { contentType }));
      } else {
        const base64 = await FileSystem.readAsStringAsync(uploadUri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        await withTimeout(
          uploadString(storageRef, base64, "base64", { contentType })
        );
      }

      const downloadUrl = await getDownloadURL(storageRef);
      setLogoUrl(downloadUrl);
    } catch (err) {
      console.error("Logo upload failed:", err);
      const timedOut = err instanceof Error && err.message === "Upload timed out";
      Alert.alert(
        "Upload failed",
        timedOut
          ? "Upload timed out. This can happen if Firebase Storage rules are blocking the write — please try again or contact support."
          : "Could not upload the image. Please try again."
      );
      setLogoUri(null);
      setLogoUrl("");
    } finally {
      setUploadingLogo(false);
    }
  };

  const removeLogo = () => {
    setLogoUri(null);
    setLogoUrl("");
  };

  // ── Deadline picker ─────────────────────────────────────────────────────────

  const openDeadlinePicker = () => {
    setPendingDate(deadline ?? new Date());
    setShowDeadlinePicker(true);
  };

  const confirmDeadline = () => {
    setDeadline(pendingDate);
    setShowDeadlinePicker(false);
  };

  const cancelDeadline = () => setShowDeadlinePicker(false);

  const handleNativeDateTimeChange = (_e: any, date?: Date) => {
    if (date) setPendingDate(date);
  };

  const handleAndroidDateChange = (_e: any, date?: Date) => {
    if (!date) return;
    setPendingDate((prev) => {
      const m = new Date(prev);
      m.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
      return m;
    });
  };

  const handleAndroidTimeChange = (_e: any, time?: Date) => {
    if (!time) return;
    setPendingDate((prev) => {
      const m = new Date(prev);
      m.setHours(time.getHours(), time.getMinutes(), 0);
      return m;
    });
  };

  const handleWebDateChange = (e: any) => {
    const val = e.target.value;
    if (!val) return;
    const [y, mo, d] = val.split("-").map(Number);
    setPendingDate((prev) => {
      const m = new Date(prev);
      m.setFullYear(y, mo - 1, d);
      return m;
    });
  };

  const handleWebTimeChange = (e: any) => {
    const val = e.target.value;
    if (!val) return;
    const [h, min] = val.split(":").map(Number);
    setPendingDate((prev) => {
      const m = new Date(prev);
      m.setHours(h, min, 0);
      return m;
    });
  };

  // ── Validation ──────────────────────────────────────────────────────────────

  const duplicateEmails = aspirants
    .map((a) => a.email.trim().toLowerCase())
    .filter((e, i, arr) => e && arr.indexOf(e) !== i);

  const validatedVotersList: ParsedVoter[] = !requiresVoterValidation
    ? []
    : voterValidationMode === "file"
      ? uploadedVoters
      : manualVoters
        .map((v) => ({
          name: v.name.trim(),
          email: v.email.trim(),
        }))
        .filter((v) => v.name && v.email);

  const voterEmailDuplicates = validatedVotersList
    .map((v) => v.email.trim().toLowerCase())
    .filter((e, i, arr) => e && arr.indexOf(e) !== i);

  const voterEmailsInvalid = validatedVotersList.some(
    (v) => v.email && !isValidEmail(v.email)
  );

  const voterValidationValid =
    !requiresVoterValidation ||
    (!parsingFile &&
      validatedVotersList.length > 0 &&
      voterEmailDuplicates.length === 0 &&
      !voterEmailsInvalid);

  const isFormValid =
    title.trim().length > 0 &&
    !uploadingLogo &&
    aspirants.every((a) => a.name.trim().length > 0 && isValidEmail(a.email)) &&
    aspirants.every((a) => !a.uploadingPhoto) &&
    duplicateEmails.length === 0 &&
    deadline !== null &&
    voterValidationValid;

  // ── Derived progress (UI only) ──────────────────────────────────────────────

  const aspirantsValidCount = aspirants.filter(
    (a) => a.name.trim().length > 0 && isValidEmail(a.email)
  ).length;

  // ── Publish ─────────────────────────────────────────────────────────────────
  //
  // Writes to:
  //   CREATOR_DB/{creatorEmail}
  //   POLL_TITLE_DB/{creatorEmail}/polls/{pollId}
  //   ASPIRANTS_DETAILS_DB/{creatorEmail}/{pollId}/{aspirantEmail}
  //   VALIDATED_VOTERS_DB/{creatorEmail}/{pollId}/{code}   (only if requires_voters_validation)

  const handlePublish = async () => {
    if (!isFormValid || !rawUserEmail) return;
    setPublishing(true);

    try {
      const creatorEmail = rawUserEmail;
      const now = new Date();

      // 1. Upsert creator in CREATOR_DB
      const creatorRef = doc(db, "CREATOR_DB", creatorEmail);
      const creatorSnap = await getDoc(creatorRef);
      if (!creatorSnap.exists()) {
        await setDoc(creatorRef, {
          name: userName || "Unknown",
          email: creatorEmail,
          status: "active",
          createdAt: serverTimestamp(),
          dateCreated: now.toLocaleDateString(),
          timeCreated: now.toLocaleTimeString(),
        });
      }

      // 2. Verify creator is active
      const latestSnap = await getDoc(creatorRef);
      if (latestSnap.data()?.status !== "active") {
        Alert.alert("Account inactive", "Your creator account is not active.");
        return;
      }

      // 3. Generate poll ID
      const pollId = generatePollId();

      // 4. Save poll → POLL_TITLE_DB/{creatorEmail}/polls/{pollId}
      await setDoc(doc(db, "POLL_TITLE_DB", creatorEmail, "polls", pollId), {
        pollId,
        title: title.trim(),
        pollType,
        requires_voters_validation: requiresVoterValidation,
        isAnonymous,
        showResults,
        logoUrl,
        deadline: deadline ? deadline.toISOString() : null,
        status: "active",
        poll_verification_status: "not_verified",
        creatorEmail,
        creatorName: userName || "Unknown",
        aspirantCount: aspirants.length,
        createdAt: serverTimestamp(),
        dateCreated: now.toLocaleDateString(),
        timeCreated: now.toLocaleTimeString(),
      });

      // 5. Save aspirants → ASPIRANTS_DETAILS_DB/{creatorEmail}/{pollId}/{aspirantEmail}
      await Promise.all(
        aspirants.map((aspirant) => {
          const aspirantEmail = aspirant.email.trim().toLowerCase();
          return setDoc(
            doc(db, "ASPIRANTS_DETAILS_DB", creatorEmail, pollId, aspirantEmail),
            {
              name: aspirant.name.trim(),
              email: aspirantEmail,
              // Uploaded photo URL when provided; otherwise a random color
              // (e.g. "#1F9F4E") acts as the aspirant's default avatar.
              photo: aspirant.photoUrl || getRandomAspirantColor(),
              votes: 0,
              lastVotedAt: null,
              pollId,
              creatorEmail,
              addedAt: serverTimestamp(),
            }
          );
        })
      );

      // 6. Save validated voters → VALIDATED_VOTERS_DB/{creatorEmail}/{pollId}/{code}
      //    Only when this poll restricts voting to a pre-approved list.
      if (requiresVoterValidation && validatedVotersList.length > 0) {
        await Promise.all(
          validatedVotersList.map((voter) => {
            const docId = sanitizeDocId(voter.email);
            return setDoc(
              doc(db, "VALIDATED_VOTERS_DB", creatorEmail, pollId, docId),
              {
                name: voter.name.trim(),
                email: voter.email.trim().toLowerCase(),
                hasVoted: false,
                pollId,
                creatorEmail,
                addedAt: serverTimestamp(),
              }
            );
          })
        );
      }

      // 7. Notify users that a new poll has been created.
      try {
        await fetch(
          "https://email-service-570014654568.us-central1.run.app/push_notification",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title:
                pollType === "multiple"
                  ? "New Multi-Vote Poll Created"
                  : "New Poll Created",
              body: `Poll "${title.trim()}" created by ${userName || "Guest"}.`,
              data: { screen: "chat/PollsListScreen" },
            }),
          }
        );
      } catch (err) {
        console.log("Push notification error:", err);
      }

      setPublishedTitle(title.trim());
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    } catch (err) {
      console.error("Publish failed:", err);
      Alert.alert("Error", "Failed to publish poll. Please try again.");
    } finally {
      setPublishing(false);
    }
  };

  const handleViewPoll = () => {
    router.navigate("./PollsListScreen");
  };

  const handleDone = () => {
    router.navigate("./members_list");
  };

  // ── UI ───────────────────────────────────────────────────────────────────────

  return (
    <ReusableScreen>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* ── Header ── */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.navigate("./members_list")}
            style={styles.backBtn}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="arrow-back" size={18} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Create a Poll</Text>
        </View>

        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >

          {publishedTitle && (
            <View style={styles.successBanner}>
              <View style={styles.successHeaderRow}>
                <View style={styles.successIconWrap}>
                  <Ionicons name="checkmark-circle" size={22} color="#1F9F4E" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.successTitle}>Poll published!</Text>
                  <Text style={styles.successDesc} numberOfLines={1}>
                    "{publishedTitle}" is now live.
                  </Text>
                </View>
              </View>

              <View style={styles.segmentedBtn}>
                <TouchableOpacity
                  style={styles.segmentLeft}
                  onPress={handleViewPoll}
                  activeOpacity={0.85}
                >
                  <Ionicons name="eye-outline" size={14} color="#fff" />
                  <Text style={styles.segmentLeftText}>VIEW POLL</Text>
                </TouchableOpacity>
                <View style={styles.segmentDivider} />
                <TouchableOpacity
                  style={styles.segmentRight}
                  onPress={handleDone}
                  activeOpacity={0.85}
                >
                  <Text style={styles.segmentRightText}>DONE</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* ── Poll details card ── */}
          <View style={styles.card}>
            <View style={styles.sectionHeaderRow}>
              <View style={[styles.sectionIconWrap, { backgroundColor: "#EAF6EE" }]}>
                <Ionicons name="document-text-outline" size={15} color="#1F9F4E" />
              </View>
              <Text style={styles.sectionLabel}>Poll details</Text>
            </View>

            <Text style={styles.fieldLabel}>Title *</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. HTU-SRC Presidential Poll, 2026"
              placeholderTextColor="#a1a1a1ff"
              value={title}
              onChangeText={setTitle}
              maxLength={120}
              returnKeyType="next"
            />

            <Text style={[styles.fieldLabel, { marginTop: 14 }]}>
              Logo <Text style={styles.optional}>(Optional)</Text>
            </Text>

            {logoUri ? (
              <View style={styles.logoPreviewWrap}>
                <Image source={{ uri: logoUri }} style={styles.logoPreview} resizeMode="cover" />
                {uploadingLogo && (
                  <View style={styles.logoUploadOverlay}>
                    <ActivityIndicator color="#fff" size="small" />
                    <Text style={styles.logoUploadText}>Uploading…</Text>
                  </View>
                )}
                {!uploadingLogo && (
                  <TouchableOpacity style={styles.logoRemoveBtn} onPress={removeLogo}>
                    <Ionicons name="close-circle" size={22} color="#ef4444" />
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              <TouchableOpacity style={styles.logoRow} onPress={pickLogo} activeOpacity={0.7}>
                <Ionicons name="image-outline" size={18} color="#1F9F4E" />
                <Text style={styles.logoText}>Tap to add logo or banner image</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* ── Poll type card ── */}
          <View style={styles.card}>
            <View style={styles.sectionHeaderRow}>
              <View style={[styles.sectionIconWrap, { backgroundColor: "#EAF6EE" }]}>
                <Ionicons name="options-outline" size={15} color="#1F9F4E" />
              </View>
              <Text style={styles.sectionLabel}>Poll type</Text>
            </View>

            <TouchableOpacity
              style={[styles.radioRow, pollType === "single" && styles.radioRowActive]}
              onPress={() => setPollType("single")}
              activeOpacity={0.8}
            >
              <View style={styles.radioOuter}>
                {pollType === "single" && <View style={styles.radioInner} />}
              </View>
              <View style={styles.radioText}>
                <Text style={[styles.radioTitle, pollType === "single" && styles.radioTitleActive]}>
                  Single-Vote
                </Text>
                <Text style={styles.radioDesc}>Each voter casts exactly one vote.</Text>
              </View>
              {pollType === "single" && (
                <Ionicons name="checkmark-circle" size={18} color="#1F9F4E" />
              )}
            </TouchableOpacity>

            <View style={styles.dividerThin} />

            <TouchableOpacity
              style={[styles.radioRow, pollType === "multiple" && styles.radioRowActive]}
              onPress={() => setPollType("multiple")}
              activeOpacity={0.8}
            >
              <View style={styles.radioOuter}>
                {pollType === "multiple" && <View style={styles.radioInner} />}
              </View>
              <View style={styles.radioText}>
                <Text style={[styles.radioTitle, pollType === "multiple" && styles.radioTitleActive]}>
                  Multiple-Voting
                </Text>
                <Text style={styles.radioDesc}>Each voter can vote for more than one aspirant.</Text>
              </View>
              {pollType === "multiple" && (
                <Ionicons name="checkmark-circle" size={18} color="#1F9F4E" />
              )}
            </TouchableOpacity>
          </View>

          {/* ── Aspirants card ── */}
          <View style={styles.card}>
            <View style={styles.sectionHeaderRow}>
              <View style={[styles.sectionIconWrap, { backgroundColor: "#EAF6EE" }]}>
                <Ionicons name="people-outline" size={15} color="#1F9F4E" />
              </View>
              <Text style={styles.sectionLabel}>Aspirants</Text>
              <View style={styles.aspirantProgressPill}>
                <Text style={styles.aspirantProgressText}>
                  {aspirantsValidCount}/{aspirants.length} ready
                </Text>
              </View>
            </View>
            <Text style={styles.fieldHint}>
              Add candidates with their name and email (min 2, max 10)
            </Text>

            {aspirants.map((asp, index) => {
              const nameOk = asp.name.trim().length > 0;
              const emailOk = isValidEmail(asp.email);
              const isDup = duplicateEmails.includes(asp.email.trim().toLowerCase());
              const aspirantComplete = nameOk && emailOk && !isDup;
              const avatarColor = AVATAR_PALETTE[index % AVATAR_PALETTE.length];

              return (
                <View
                  key={asp.id}
                  style={[styles.aspirantCard, aspirantComplete && styles.aspirantCardComplete]}
                >
                  <View style={styles.aspirantHeaderRow}>
                    <View style={[styles.optionIndex, { backgroundColor: avatarColor }]}>
                      <Text style={styles.optionIndexText}>{index + 1}</Text>
                    </View>
                    <Text style={styles.aspirantLabel}>Aspirant {index + 1}</Text>
                    {aspirantComplete && (
                      <Ionicons name="checkmark-circle" size={16} color="#1F9F4E" />
                    )}
                    {aspirants.length > 2 && (
                      <TouchableOpacity
                        onPress={() => removeAspirant(asp.id)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Ionicons name="close-circle" size={20} color="#d1d5db" />
                      </TouchableOpacity>
                    )}
                  </View>

                  <Text style={styles.subFieldLabel}>Full Name *</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. John Mensah"
                    placeholderTextColor="#b0b0b0"
                    value={asp.name}
                    onChangeText={(t) => updateAspirant(asp.id, "name", t)}
                    maxLength={80}
                    returnKeyType="next"
                  />

                  <Text style={[styles.subFieldLabel, { marginTop: 10 }]}>Email Address *</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. john.mensah@example.com"
                    placeholderTextColor="#b0b0b0"
                    value={asp.email}
                    onChangeText={(t) => updateAspirant(asp.id, "email", t)}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    maxLength={120}
                    returnKeyType="next"
                  />
                  {asp.email.trim() && !isValidEmail(asp.email) && (
                    <Text style={styles.errorText}>Invalid email address</Text>
                  )}
                  {isDup && (
                    <Text style={styles.errorText}>
                      Duplicate — each aspirant must have a unique email
                    </Text>
                  )}

                  <Text style={[styles.subFieldLabel, { marginTop: 10 }]}>
                    Photo <Text style={styles.optional}>(Optional)</Text>
                  </Text>
                  {asp.photoUri ? (
                    <View style={styles.aspirantPhotoPreviewWrap}>
                      <Image
                        source={{ uri: asp.photoUri }}
                        style={styles.aspirantPhotoPreview}
                        resizeMode="cover"
                      />
                      {asp.uploadingPhoto && (
                        <View style={styles.aspirantPhotoUploadOverlay}>
                          <ActivityIndicator color="#fff" size="small" />
                        </View>
                      )}
                      {!asp.uploadingPhoto && (
                        <TouchableOpacity
                          style={styles.aspirantPhotoRemoveBtn}
                          onPress={() => removeAspirantPhoto(asp.id)}
                          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                        >
                          <Ionicons name="close-circle" size={18} color="#ef4444" />
                        </TouchableOpacity>
                      )}
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={styles.aspirantPhotoRow}
                      onPress={() => pickAspirantPhoto(asp.id)}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="camera-outline" size={16} color="#1F9F4E" />
                      <Text style={styles.aspirantPhotoText}>
                        Tap to add a photo — a color avatar is used if skipped
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}

            {aspirants.length < 10 && (
              <TouchableOpacity style={styles.addOptionBtn} onPress={addAspirant}>
                <Ionicons name="add-circle-outline" size={16} color="#1F9F4E" />
                <Text style={styles.addOptionText}>Add aspirant</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* ── Settings card ── */}
          <View style={styles.card}>
            <View style={styles.sectionHeaderRow}>
              <View style={[styles.sectionIconWrap, { backgroundColor: "#EAF6EE" }]}>
                <Ionicons name="settings-outline" size={15} color="#1F9F4E" />
              </View>
              <Text style={styles.sectionLabel}>Settings</Text>
            </View>

            {/* requires_voters_validation toggle */}
            <View style={styles.toggleRow}>
              <View style={styles.toggleIconWrap}>
                <Ionicons name="shield-checkmark-outline" size={15} color="#6b7280" />
              </View>
              <View style={styles.toggleText}>
                <Text style={styles.toggleLabel}>Require voter validation</Text>
                <Text style={styles.toggleDesc}>
                  Only voters you pre-approve below can vote in this poll.
                </Text>
              </View>
              <Switch
                value={requiresVoterValidation}
                onValueChange={setRequiresVoterValidation}
                trackColor={{ false: "#e5e7eb", true: "#A2E0B8" }}
                thumbColor={requiresVoterValidation ? "#1F9F4E" : "#9ca3af"}
              />
            </View>

            <View style={styles.dividerThin} />

            <Text style={[styles.fieldHint, { color: "#3e3f3fff", fontSize: 14, fontWeight: "600" }]}>Voting deadline *</Text>
            <Text style={styles.fieldHint}>
              Required - voters can only vote until this date & time.
            </Text>

            <TouchableOpacity
              style={[styles.deadlineRow, deadline ? styles.deadlineRowActive : null]}
              onPress={openDeadlinePicker}
              activeOpacity={0.7}
            >
              <Ionicons name="calendar-outline" size={16} color="#1F9F4E" />
              <Text style={[styles.deadlineText, deadline ? styles.deadlineTextActive : null]}>
                {deadline ? deadline.toLocaleString() : "Set end date & time"}
              </Text>
            </TouchableOpacity>

            {!deadline && (
              <Text style={[styles.errorText, { marginLeft: 35 }]}>Voting deadline is required</Text>
            )}

            {showDeadlinePicker && (
              <View style={styles.inlinePickerBox}>
                <Text style={styles.inlinePickerPreview}>
                  {pendingDate.toLocaleString()}
                </Text>

                {Platform.OS === "ios" && (
                  <DateTimePicker
                    value={pendingDate}
                    mode="datetime"
                    display="spinner"
                    onChange={handleNativeDateTimeChange}
                    minimumDate={new Date()}
                    style={{ width: "100%" }}
                  />
                )}

                {Platform.OS === "android" && (
                  <View style={styles.androidPickersRow}>
                    <DateTimePicker
                      value={pendingDate}
                      mode="date"
                      display="spinner"
                      onChange={handleAndroidDateChange}
                      minimumDate={new Date()}
                      style={styles.androidSpinner}
                    />
                    <DateTimePicker
                      value={pendingDate}
                      mode="time"
                      display="spinner"
                      onChange={handleAndroidTimeChange}
                      style={styles.androidSpinner}
                    />
                  </View>
                )}

                {Platform.OS === "web" && (
                  <View style={styles.webPickersRow}>
                    <input
                      type="date"
                      value={toDateInputValue(pendingDate)}
                      min={toDateInputValue(new Date())}
                      onChange={handleWebDateChange}
                      style={webInputStyle}
                    />
                    <input
                      type="time"
                      value={toTimeInputValue(pendingDate)}
                      onChange={handleWebTimeChange}
                      style={webInputStyle}
                    />
                  </View>
                )}

                <View style={styles.inlinePickerActions}>
                  <TouchableOpacity onPress={cancelDeadline} style={styles.inlineCancelBtn}>
                    <Text style={styles.inlineCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={confirmDeadline} style={styles.inlineDoneBtn}>
                    <Text style={styles.inlineDoneText}>Done</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            <View style={styles.dividerThin} />

            <View style={styles.toggleRow}>
              <View style={styles.toggleIconWrap}>
                <Ionicons name="eye-off-outline" size={15} color="#6b7280" />
              </View>
              <View style={styles.toggleText}>
                <Text style={styles.toggleLabel}>Anonymous voting</Text>
                <Text style={styles.toggleDesc}>
                  Voter identities will be hidden from results.
                </Text>
              </View>
              <Switch
                value={isAnonymous}
                onValueChange={setIsAnonymous}
                trackColor={{ false: "#e5e7eb", true: "#A2E0B8" }}
                thumbColor={isAnonymous ? "#1F9F4E" : "#9ca3af"}
              />
            </View>

            <View style={styles.dividerThin} />

            <View style={styles.toggleRow}>
              <View style={styles.toggleIconWrap}>
                <Ionicons name="stats-chart-outline" size={15} color="#6b7280" />
              </View>
              <View style={styles.toggleText}>
                <Text style={styles.toggleLabel}>Show live results</Text>
                <Text style={styles.toggleDesc}>
                  Voters can see results as voting progresses.
                </Text>
              </View>
              <Switch
                value={showResults}
                onValueChange={setShowResults}
                trackColor={{ false: "#e5e7eb", true: "#A2E0B8" }}
                thumbColor={showResults ? "#1F9F4E" : "#9ca3af"}
              />
            </View>
          </View>

          {/* ── Validated voters card (shown only when the toggle above is ON) ── */}
          {requiresVoterValidation && (
            <View style={styles.card}>
              <View style={styles.sectionHeaderRow}>
                <View style={[styles.sectionIconWrap, { backgroundColor: "#EAF6EE" }]}>
                  <Ionicons name="shield-checkmark-outline" size={15} color="#1F9F4E" />
                </View>
                <Text style={styles.sectionLabel}>Validated Voters</Text>
                <View style={styles.aspirantProgressPill}>
                  <Text style={styles.aspirantProgressText}>
                    {validatedVotersList.length} ready
                  </Text>
                </View>
              </View>
              <Text style={styles.fieldHint}>
                Add every voter allowed to vote — name and email. They'll be saved to
                VALIDATED_VOTERS_DB for this poll.
              </Text>

              {/* Option 1 vs Option 2 switch */}
              <View style={styles.modeSwitchRow}>
                <TouchableOpacity
                  style={[
                    styles.modeButton,
                    voterValidationMode === "manual" && styles.modeButtonActive,
                  ]}
                  onPress={() => setVoterValidationMode("manual")}
                  activeOpacity={0.8}
                >
                  <Ionicons
                    name="create-outline"
                    size={14}
                    color={voterValidationMode === "manual" ? "#fff" : "#6b7280"}
                  />
                  <Text
                    style={[
                      styles.modeButtonText,
                      voterValidationMode === "manual" && styles.modeButtonTextActive,
                    ]}
                  >
                    Manual Entry
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.modeButton,
                    voterValidationMode === "file" && styles.modeButtonActive,
                  ]}
                  onPress={() => setVoterValidationMode("file")}
                  activeOpacity={0.8}
                >
                  <Ionicons
                    name="cloud-upload-outline"
                    size={14}
                    color={voterValidationMode === "file" ? "#fff" : "#6b7280"}
                  />
                  <Text
                    style={[
                      styles.modeButtonText,
                      voterValidationMode === "file" && styles.modeButtonTextActive,
                    ]}
                  >
                    Upload File
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Option 2: Manual entry — dynamic rows, "+" to add another */}
              {voterValidationMode === "manual" && (
                <View>
                  {manualVoters.map((voter, index) => {
                    const emailTrim = voter.email.trim();
                    const email = emailTrim.toLowerCase();
                    const isDupEmail = !!email && voterEmailDuplicates.includes(email);
                    const isBadEmail = !!emailTrim && !isValidEmail(emailTrim);
                    return (
                      <View key={voter.id} style={styles.voterRow}>
                        <View style={styles.voterRowEmailWrap}>
                          <TextInput
                            style={[styles.input, styles.voterInputName]}
                            placeholder="Voter name"
                            placeholderTextColor="#b0b0b0"
                            value={voter.name}
                            onChangeText={(t) => updateManualVoter(voter.id, "name", t)}
                            maxLength={80}
                          />
                          <TextInput
                            style={[styles.input, styles.voterInputEmail]}
                            placeholder="Email address"
                            placeholderTextColor="#b0b0b0"
                            value={voter.email}
                            onChangeText={(t) => updateManualVoter(voter.id, "email", t)}
                            keyboardType="email-address"
                            autoCapitalize="none"
                            maxLength={120}
                          />
                          {manualVoters.length > 1 && (
                            <TouchableOpacity
                              onPress={() => removeManualVoter(voter.id)}
                              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                              style={styles.removeVoterBtn}
                            >
                              <Ionicons name="close-circle" size={20} color="#d1d5db" />
                            </TouchableOpacity>
                          )}
                        </View>
                        {isDupEmail && (
                          <Text style={styles.errorText}>
                            Duplicate email — each voter needs a unique email
                          </Text>
                        )}
                        {isBadEmail && !isDupEmail && (
                          <Text style={styles.errorText}>Invalid email address</Text>
                        )}
                      </View>
                    );
                  })}

                  <TouchableOpacity style={styles.addVoterBtn} onPress={addManualVoter}>
                    <Ionicons name="add-circle-outline" size={16} color="#1F9F4E" />
                    <Text style={styles.addVoterText}>Add voter</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Option 1: File upload — CSV, Excel, or Text */}
              {voterValidationMode === "file" && (
                <View>
                  {!uploadedFileName ? (
                    <TouchableOpacity
                      style={styles.fileUploadBox}
                      onPress={pickVoterFile}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="document-attach-outline" size={20} color="#1F9F4E" />
                      <Text style={styles.fileUploadText}>
                        Tap to upload CSV, Excel, or Text file
                      </Text>
                      <Text style={styles.fileUploadHint}>
                        One voter per row — Name, Email (e.g. John Mensah, john@example.com)
                      </Text>
                    </TouchableOpacity>
                  ) : (
                    <View style={styles.fileLoadedCard}>
                      <View style={styles.fileLoadedHeader}>
                        <Ionicons name="document-text-outline" size={18} color="#1F9F4E" />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.fileLoadedName} numberOfLines={1}>
                            {uploadedFileName}
                          </Text>
                          {parsingFile ? (
                            <Text style={styles.fileLoadedCount}>Parsing…</Text>
                          ) : (
                            <Text style={styles.fileLoadedCount}>
                              {uploadedVoters.length} voter{uploadedVoters.length === 1 ? "" : "s"} loaded
                            </Text>
                          )}
                        </View>
                        {parsingFile && <ActivityIndicator size="small" color="#1F9F4E" />}
                      </View>

                      {!parsingFile && uploadedVoters.length > 0 && (
                        <View style={styles.filePreviewList}>
                          {uploadedVoters.slice(0, 5).map((v, i) => (
                            <Text key={`${v.email}-${i}`} style={styles.filePreviewItem}>
                              {v.name} · {v.email}
                            </Text>
                          ))}
                          {uploadedVoters.length > 5 && (
                            <Text style={styles.filePreviewMore}>
                              +{uploadedVoters.length - 5} more
                            </Text>
                          )}
                        </View>
                      )}

                      <View style={styles.fileActionsRow}>
                        <TouchableOpacity onPress={pickVoterFile} style={styles.fileChangeBtn}>
                          <Text style={styles.fileActionText}>Change file</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={clearUploadedFile} style={styles.fileRemoveBtn}>
                          <Text style={[styles.fileActionText, { color: "#ef4444" }]}>Remove</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}

                  {fileParseError && <View><Text style={styles.errorText}>{fileParseError}</Text></View>}
                  {!fileParseError && voterEmailDuplicates.length > 0 && (
                    <View><Text style={styles.errorText}>
                      This file has duplicate emails - each voter needs a unique email.
                    </Text></View>
                  )}
                </View>
              )}
            </View>
          )}

          {/* ── Publish ── */}
          <TouchableOpacity
            style={[
              styles.publishBtn,
              (!isFormValid || publishing) && styles.publishBtnDisabled,
            ]}
            onPress={handlePublish}
            activeOpacity={0.85}
            disabled={!isFormValid || publishing}
          >
            {publishing ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <MaterialIcons name="how-to-vote" size={18} color="#fff" />
                <Text style={styles.publishText}>Publish Poll</Text>
              </>
            )}
          </TouchableOpacity>

          {!isFormValid && !publishing && (
            <Text style={styles.validationHint}>
              Fill in all required fields to enable publishing.
            </Text>
          )}

          <Text style={styles.footerNote}>
            Once published, the poll will be visible to all community members.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </ReusableScreen>
  );
}

// ─── Web-only datetime input style ───────────────────────────────────────────

const webInputStyle: any = {
  flex: 1,
  fontSize: 15,
  padding: 12,
  borderRadius: 10,
  border: "1px solid #e5e7eb",
  backgroundColor: "#fff",
  color: "#1a1a1a",
  outline: "none",
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: "#f5f6f8" },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#fff",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: "#e5e7eb",
  },
  backBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#1F9F4E",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { fontSize: 17, fontWeight: "700", color: "#1a1a1a", letterSpacing: -0.2 },

  scroll: { flex: 1, backgroundColor: "#deead9ff", margin: 5, },
  scrollContent: { paddingHorizontal: 4, paddingTop: 5, paddingBottom: 30 },

  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 6,
    borderWidth: 1.4,
    borderColor: "#d9dad9ff",
    marginBottom: 5,
  },

  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 14,
  },
  sectionIconWrap: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: "#1F9F4E",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    flex: 1,
  },
  aspirantProgressPill: {
    backgroundColor: "#f3f4f6",
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 20,
  },
  aspirantProgressText: { fontSize: 13, fontWeight: "700", color: "#6b7280" },

  fieldLabel: { fontSize: 13, fontWeight: "600", color: "#374151", marginBottom: 6 },
  subFieldLabel: { fontSize: 12, fontWeight: "600", color: "#6b7280", marginBottom: 5 },
  optional: { fontWeight: "400", color: "#9ca3af" },
  fieldHint: { marginLeft: 35, fontSize: 12, color: "#9ca3af", marginBottom: 12, marginTop: -8 },

  input: {
    borderWidth: 1,
    borderColor: "#e0e1e3ff",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 14,
    color: "#1a1a1a",
    backgroundColor: "#f0f1f2ff",
    ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as any) : {}),
  },
  inputError: { borderColor: "#ef4444", backgroundColor: "#fff5f5" },
  errorText: { fontSize: 13, color: "#ef4444", marginTop: 4, marginLeft: 2 },

  logoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: "#A2E0B8",
    borderStyle: "dashed",
    borderRadius: 10,
    padding: 12,
    backgroundColor: "#EAF6EE",
  },
  logoText: { fontSize: 13, color: "#1F9F4E" },
  logoPreviewWrap: {
    position: "relative",
    borderRadius: 10,
    overflow: "hidden",
    height: 160,
    backgroundColor: "#f3f4f6",
  },
  logoPreview: { width: "100%", height: "100%" },
  logoUploadOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  logoUploadText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  logoRemoveBtn: {
    position: "absolute",
    top: 8,
    right: 8,
    backgroundColor: "#fff",
    borderRadius: 12,
  },

  aspirantPhotoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: "#A2E0B8",
    borderStyle: "dashed",
    borderRadius: 10,
    padding: 10,
    backgroundColor: "#EAF6EE",
  },
  aspirantPhotoText: { fontSize: 12, color: "#1F9F4E", flex: 1 },
  aspirantPhotoPreviewWrap: {
    position: "relative",
    width: 64,
    height: 64,
    borderRadius: 32,
    overflow: "hidden",
    backgroundColor: "#f3f4f6",
  },
  aspirantPhotoPreview: { width: "100%", height: "100%" },
  aspirantPhotoUploadOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  aspirantPhotoRemoveBtn: {
    position: "absolute",
    top: -4,
    right: -4,
    backgroundColor: "#fff",
    borderRadius: 10,
  },

  radioRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  radioRowActive: { backgroundColor: "#EAF6EE" },
  radioOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: "#1F9F4E",
    alignItems: "center",
    justifyContent: "center",
  },
  radioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#1F9F4E" },
  radioText: { flex: 1 },
  radioTitle: { fontSize: 15, fontWeight: "600", color: "#374151" },
  radioTitleActive: { color: "#1F9F4E" },
  radioDesc: { fontSize: 12, color: "#9ca3af", marginTop: 2 },

  aspirantCard: {
    borderWidth: 1,
    borderColor: "#eef0f2",
    backgroundColor: "#fafbfc",
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  aspirantCardComplete: { borderColor: "#cdeed9", backgroundColor: "#fbfffc" },
  aspirantHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  aspirantLabel: { flex: 1, fontSize: 13, fontWeight: "700", color: "#374151" },
  optionIndex: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  optionIndexText: { fontSize: 12, fontWeight: "700", color: "#fff" },
  addOptionBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingTop: 4, justifyContent: "center" },
  addOptionText: { fontSize: 13, color: "#1F9F4E", fontWeight: "600" },

  deadlineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    backgroundColor: "#fafafa",
    marginBottom: 8,
  },
  deadlineRowActive: { borderColor: "#1F9F4E", backgroundColor: "#EAF6EE" },
  deadlineText: { flex: 1, fontSize: 14, color: "#9ca3af" },
  deadlineTextActive: { color: "#1F9F4E", fontWeight: "500" },

  inlinePickerBox: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    backgroundColor: "#fafafa",
  },
  inlinePickerPreview: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1F9F4E",
    textAlign: "center",
    marginBottom: 8,
  },
  androidPickersRow: { flexDirection: "row", justifyContent: "center" },
  androidSpinner: { flex: 1 },
  webPickersRow: { flexDirection: "row", gap: 10 },
  inlinePickerActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 16,
    marginTop: 10,
  },
  inlineCancelBtn: { paddingVertical: 6, paddingHorizontal: 4 },
  inlineCancelText: { fontSize: 14, fontWeight: "500", color: "#9ca3af" },
  inlineDoneBtn: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: "#1F9F4E",
  },
  inlineDoneText: { fontSize: 14, fontWeight: "700", color: "#fff" },

  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
  },
  toggleIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: "#f3f4f6",
    alignItems: "center",
    justifyContent: "center",
  },
  toggleText: { flex: 1 },
  toggleLabel: { fontSize: 14, fontWeight: "600", color: "#374151" },
  toggleDesc: { fontSize: 12, color: "#9ca3af", marginTop: 2 },

  modeSwitchRow: {
    flexDirection: "row",
    gap: 8,
    backgroundColor: "#f3f4f6",
    borderRadius: 10,
    padding: 4,
    marginBottom: 14,
  },
  modeButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 9,
    borderRadius: 8,
  },
  modeButtonActive: { backgroundColor: "#1F9F4E" },
  modeButtonText: { fontSize: 13, fontWeight: "600", color: "#6b7280" },
  modeButtonTextActive: { color: "#fff" },

  voterRow: { marginBottom: 10 },
  voterRowInputs: { flexDirection: "row", gap: 8 },
  voterInputName: { flex: 1.4 },
  voterInputCode: { flex: 1 },
  voterRowEmailWrap: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  voterInputEmail: { flex: 1 },
  removeVoterBtn: { padding: 2 },
  addVoterBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingTop: 4, justifyContent: "center" },
  addVoterText: { fontSize: 13, color: "#1F9F4E", fontWeight: "600" },

  fileUploadBox: {
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: "#A2E0B8",
    borderStyle: "dashed",
    borderRadius: 10,
    padding: 20,
    backgroundColor: "#EAF6EE",
  },
  fileUploadText: { fontSize: 13, color: "#1F9F4E", fontWeight: "600" },
  fileUploadHint: { fontSize: 11, color: "#6b9c7c", textAlign: "center" },
  fileLoadedCard: {
    borderWidth: 1,
    borderColor: "#cdeed9",
    borderRadius: 10,
    padding: 12,
    backgroundColor: "#fbfffc",
  },
  fileLoadedHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  fileLoadedName: { fontSize: 13, fontWeight: "700", color: "#374151" },
  fileLoadedCount: { fontSize: 12, color: "#6b7280", marginTop: 1 },
  filePreviewList: { marginTop: 10, gap: 3 },
  filePreviewItem: { fontSize: 12, color: "#4b5563" },
  filePreviewMore: { fontSize: 12, color: "#9ca3af", fontStyle: "italic", marginTop: 2 },
  fileActionsRow: { flexDirection: "row", gap: 16, marginTop: 10 },
  fileChangeBtn: { paddingVertical: 4 },
  fileRemoveBtn: { paddingVertical: 4 },
  fileActionText: { fontSize: 13, fontWeight: "600", color: "#1F9F4E" },

  successBanner: {
    backgroundColor: "#fff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#cdeed9",
    padding: 14,
    marginBottom: 14,
    gap: 12,
    ...Platform.select({
      ios: { shadowColor: "#1F9F4E", shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
      android: { elevation: 1 },
      default: { boxShadow: "0 1px 4px rgba(31,159,78,0.08)" } as any,
    }),
  },
  successHeaderRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  successIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#EAF6EE",
    alignItems: "center",
    justifyContent: "center",
  },
  successTitle: { fontSize: 14.5, fontWeight: "700", color: "#1a1a1a" },
  successDesc: { fontSize: 12.5, color: "#6b7280", marginTop: 1 },

  segmentedBtn: {
    flexDirection: "row",
    height: 44,
    borderRadius: 12,
    overflow: "hidden",
  },
  segmentLeft: {
    flex: 1.3,
    backgroundColor: "#1F9F4E",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  segmentLeftText: { color: "#fff", fontWeight: "700", fontSize: 12.5, letterSpacing: 0.3 },
  segmentDivider: { width: 1, backgroundColor: "rgba(255,255,255,0.25)" },
  segmentRight: {
    flex: 1,
    backgroundColor: "#17803F",
    alignItems: "center",
    justifyContent: "center",
  },
  segmentRightText: { color: "#fff", fontWeight: "700", fontSize: 12.5, letterSpacing: 0.3 },

  dividerThin: { height: 0.5, backgroundColor: "#f3f4f6", marginVertical: 2 },

  publishBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#1F9F4E",
    borderRadius: 14,
    paddingVertical: 15,
    marginTop: 10,
    shadowColor: "#1F9F4E",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  publishBtnDisabled: { backgroundColor: "#d1d5db", shadowOpacity: 0, elevation: 0 },
  publishText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  validationHint: {
    fontSize: 12,
    color: "#ef4444",
    textAlign: "center",
    marginTop: 10,
  },
  footerNote: {
    fontSize: 13,
    color: "#000",
    textAlign: "center",
    marginTop: 12,
    width: "60%",
    alignSelf: "center",
    lineHeight: 16,
  },
});
