import { GlobalContext } from "@/context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useContext } from "react";
import { Modal, View, Text, TouchableOpacity, StyleSheet, Linking } from "react-native";

export default function AnnouncementModalComponent({
  visible,
  title,
  message,
  confirmText = "OK",
  cancelText = "Cancel",
  confirmColor = "#4CAF50",
  cancelColor = "#888",
  apkVersion,
  onProfile,
  onComment,
  onCancel,
  app_update_url,
  app_update_version

}: any) {
  const {
    apkUrl,
  } = useContext(GlobalContext);
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={s.modalOverlay}>
        <View style={s.modalBoxInner}>
          <TouchableOpacity style={{ flexDirection: "row", alignItems: "center", position: "absolute", right: 10, top: 10, zIndex: 100 }} onPress={onCancel} >
            {/* <Ionicons name="lock-closed" size={17} color="#ccc" /> */}
            <Ionicons name="close-circle" size={28} color="red" />

          </TouchableOpacity>
          <View style={s.innerBox}>
            <Text style={s.modalTitle}>{title}</Text>

            <View style={{ paddingHorizontal: 15, }}><Text style={s.modalText}>{message}</Text></View>

            <View style={s.modalBtnRow}>
              <TouchableOpacity
                style={[s.modalBtn, { backgroundColor: confirmColor }]}
                onPress={() => router.replace("./profile")}
              >
                <Text style={s.modalBtnText}>{confirmText}</Text>
              </TouchableOpacity>
              {/* <TouchableOpacity
                style={[s.modalBtn, { backgroundColor: "#4CAF50" }]}
                onPress={() => router.replace("./chat_room")}
              > */}
              <TouchableOpacity
                style={[s.modalBtn, { backgroundColor: "#ccc" }]}
              >
                <Text style={s.modalBtnText}>{app_update_version ? app_update_version : "Chat"}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => router.replace("./comments")}><Ionicons style={{ alignSelf: "center", }} name="chatbubbles-outline" size={29} color="#1fac03ff" /></TouchableOpacity>

            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 15,
  },

  modalBoxInner: {
    backgroundColor: "#fff",
    borderRadius: 10,
    // width: "80%",            // ★ Keeps modal centered & proportional
    maxWidth: 350,           // ★ Prevents over-expanding on tablets
    paddingTop: 19,
    paddingBottom: 12,
    elevation: 5,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 10,
    alignItems: "center",    // ★ Ensures perfect centering
  },

  innerBox: {
    borderRadius: 8,
    paddingHorizontal: 10,
    // paddingVertical: 5,
    width: "100%",           // ★ Ensures content is properly centered and balanced
  },

  modalTitle: {
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 10,
    textAlign: "center",
  },

  modalText: {
    fontSize: 16,
    textAlign: "center",
    marginBottom: 15,
    lineHeight: 22,
  },

  modalBtnRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
    marginTop: 0,
  },

  modalBtn: {
    paddingVertical: 8,
    paddingHorizontal: 5,
    borderRadius: 6,
    flex: 1, justifyContent: "center"
  },

  modalBtnText: {
    color: "#fff",
    textAlign: "center",
    fontWeight: "600",
  },

  // (Other styles you left included)
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderTopWidth: 1,
    borderColor: "#ddd",
    backgroundColor: "#fff",
  },

  input: {
    flex: 1,
    backgroundColor: "#f0f0f0",
    borderRadius: 25,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 16,
    marginHorizontal: 6,
    maxHeight: 100,
  },

  sendBtn: {
    backgroundColor: "#eb8125ff",
    padding: 12,
    borderRadius: 25,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#fff",
  },
});
