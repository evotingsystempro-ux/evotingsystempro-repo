//PrivacyPolicy&TermsOfUse
import React from "react";
import { View, Text, ScrollView, StyleSheet, Platform } from "react-native";
import ReusableScreen from "@/components/ReusableScreen";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";

/* ── Brand Tokens ── */
const T = {
  brand: "#26B865",       // primary green from logo
  brandDeep: "#1A8A4A",   // dark green
  brandDeeper: "#146639", // deeper green for footer text / accents
  brandLight: "#E8F5ED",  // very light mint
  brandBorder: "#A8DDB5", // soft mint border
  brandMuted: "#6FCF97",  // muted green
  white: "#FFFFFF",
  ink: "#1A2E22",         // very dark green-black
  inkSoft: "#374151",
  inkMuted: "#6B7280",
  cardBg: "#FAFEFC",
};

export default function PolicyTermsScreen() {
  return (
    <ReusableScreen>

      {/* ===== FIXED HEADER ===== */}
      <View style={styles.fixedHeader}>
        <View style={styles.headerRow}>
          <Ionicons
            name="arrow-back"
            size={22}
            color={T.white}
            onPress={() => router.back()}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          />
          <Text style={styles.headerTitle}>Privacy Policy & Terms of Use</Text>
        </View>
        <Text style={styles.subHeader}>eVoting System Pro</Text>
      </View>

      {/* ===== SCROLLABLE CONTENT ===== */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        style={styles.scrollArea}
      >

        {/* ── PRIVACY POLICY ── */}
        <View style={styles.sectionBox}>
          <View style={styles.sectionTitleRow}>
            <View style={styles.sectionIconWrap}>
              <Ionicons name="shield-checkmark" size={18} color={T.white} />
            </View>
            <Text style={styles.sectionTitle}>Privacy Policy</Text>
          </View>
          <View style={styles.titleDivider} />

          <View style={styles.metaBox}>
            <MetaRow label="Effective Date" value="November 2, 2026" />
            <MetaRow label="Developer" value="eVoting System Pro Limited" />
            <MetaRow label="Contact" value="stanleyafon@gmail.com | +233 543 171 076" />
          </View>

          <SectionHeader title="1. Introduction" />
          <Text style={styles.text}>
            eVoting System Pro Limited ("we," "our," or "us") operates a secure, transparent,
            and tamper-proof digital voting platform. We are committed to protecting the integrity,
            confidentiality, and privacy of all voter data. This Privacy Policy explains how we
            collect, use, store, and safeguard your information when you use the eVoting System Pro.
          </Text>

          <SectionHeader title="2. Information We Collect" />
          <Text style={styles.text}>
            • <Text style={styles.bold}>Identity Information:</Text> Full name, email address, phone number, and profile photo for voter verification.{"\n"}
            • <Text style={styles.bold}>Device Information:</Text> Device ID, IP address, and platform details to prevent duplicate voting and fraud.{"\n"}
            • <Text style={styles.bold}>Voting Activity:</Text> Voting records stored securely and anonymized where applicable.{"\n"}
            • <Text style={styles.bold}>Biometric/Fingerprint Data:</Text> Device fingerprints used solely to enforce one-person-one-vote integrity.
          </Text>

          <SectionHeader title="3. How We Use Your Information" />
          <Text style={styles.text}>
            • Verify voter identity and eligibility{"\n"}
            • Prevent fraudulent or duplicate votes{"\n"}
            • Maintain accurate and tamper-proof vote records{"\n"}
            • Communicate election results and important updates{"\n"}
            • Improve platform security and performance{"\n\n"}
            We do not sell, rent, or share voter data with third parties for commercial purposes.
          </Text>

          <SectionHeader title="4. Vote Confidentiality" />
          <Text style={styles.text}>
            All votes are encrypted end-to-end. Individual voting choices are never disclosed
            to any third party, candidate, or administrator. Only aggregate results are published.
            Your vote is your private democratic right and will always remain confidential.
          </Text>

          <SectionHeader title="5. Data Storage & Security" />
          <Text style={styles.text}>
            We employ industry-standard encryption (AES-256), secure server infrastructure,
            and real-time fraud detection. Vote data is hosted on Firebase's secure cloud
            infrastructure with strict access controls. While no system is 100% immune,
            we apply best-in-class protections to safeguard your data.
          </Text>

          <SectionHeader title="6. Sharing of Information" />
          <Text style={styles.text}>
            We may share limited data only:{"\n"}
            • With authorized election administrators for result verification{"\n"}
            • When required by law or a valid court order{"\n"}
            • With security partners to investigate fraudulent activity{"\n\n"}
            No voter data is shared for marketing or advertising purposes under any circumstances.
          </Text>

          <SectionHeader title="7. Your Rights" />
          <Text style={styles.text}>
            You have the right to:{"\n"}
            • Access your personal data{"\n"}
            • Request corrections to inaccurate information{"\n"}
            • Request deletion of your account and associated data{"\n"}
            • Withdraw consent at any time{"\n\n"}
            Submit all requests to: stanleyafon@gmail.com
          </Text>

          <SectionHeader title="8. Minors" />
          <Text style={styles.text}>
            Voting eligibility is determined by the specific election rules set by the
            election administrator. The platform is restricted to users aged 13 and above.
            Data collected from underage users is permanently and immediately deleted.
          </Text>

          <SectionHeader title="9. Data Retention" />
          <Text style={styles.text}>
            Voter data is retained for the duration of the election and up to 12 months
            thereafter for audit and legal compliance. Upon account deletion, all personal
            data is permanently erased within 30 days.
          </Text>

          <SectionHeader title="10. Third-Party Services" />
          <Text style={styles.text}>
            We use trusted infrastructure providers including Firebase (Google). These
            providers are bound by strict data processing agreements. We are not responsible
            for the independent privacy practices of external services or links.
          </Text>

          <SectionHeader title="11. Policy Updates" />
          <Text style={styles.text}>
            We may update this policy to reflect platform improvements or legal requirements.
            Users will be notified of significant changes via in-app notification or email.
            Continued use after updates constitutes acceptance of the revised policy.
          </Text>

          <SectionHeader title="12. Contact Us" />
          <Text style={styles.text}>
            Email: stanleyafon@gmail.com{"\n"}
            Phone: +233 543 171 076
          </Text>
        </View>

        {/* ── TERMS AND CONDITIONS ── */}
        <View style={styles.sectionBox}>
          <View style={styles.sectionTitleRow}>
            <View style={styles.sectionIconWrap}>
              <Ionicons name="document-text" size={18} color={T.white} />
            </View>
            <Text style={styles.sectionTitle}>Terms & Conditions</Text>
          </View>
          <View style={styles.titleDivider} />

          <View style={styles.metaBox}>
            <MetaRow label="Effective Date" value="November 2, 2026" />
            <MetaRow label="Developer" value="eVoting System Pro Limited" />
            <MetaRow label="Contact" value="stanleyafon@gmail.com | +233 543 171 076" />
          </View>

          <SectionHeader title="1. Acceptance of Terms" />
          <Text style={styles.text}>
            By accessing or using the eVoting System Pro, you confirm that you have read,
            understood, and agreed to these Terms and Conditions in full. If you do not agree,
            you must discontinue use immediately. We reserve the right to update these terms
            at any time. Continued use after changes constitutes acceptance.
          </Text>

          <SectionHeader title="2. About the Platform" />
          <Text style={styles.text}>
            eVoting System Pro is a secure, auditable digital voting platform designed to
            conduct fair, transparent, and tamper-proof elections. The platform supports
            community polls, organizational elections, and competitive voting events, with
            features including real-time results, voter verification, and advanced anti-fraud mechanisms.
          </Text>

          <SectionHeader title="3. Voter Eligibility" />
          <Text style={styles.text}>
            • You must meet the age and eligibility criteria defined by the specific election.{"\n"}
            • Each registered user is permitted one vote per election unless stated otherwise.{"\n"}
            • You must register with accurate, truthful, and verifiable personal information.{"\n"}
            • Impersonating another voter constitutes electoral fraud and may result in criminal prosecution.
          </Text>

          <SectionHeader title="4. Account Registration" />
          <Text style={styles.text}>
            • Provide accurate and up-to-date registration details at all times.{"\n"}
            • You are solely responsible for maintaining the security of your login credentials.{"\n"}
            • One account per person is strictly enforced. Multiple accounts will be permanently suspended.{"\n"}
            • We reserve the right to verify identity before granting voting access.{"\n"}
            • We are not liable for unauthorized access resulting from user negligence or credential sharing.
          </Text>

          <SectionHeader title="5. Voting Rules & Integrity" />
          <Text style={styles.text}>
            • Each eligible voter may cast exactly one vote per election — no exceptions.{"\n"}
            • Votes are final and irrevocable once submitted.{"\n"}
            • All votes are encrypted and stored securely with a full audit trail.{"\n"}
            • Voting multiple times using different accounts, devices, or identities is strictly prohibited.{"\n"}
            • Device fingerprinting and behavioral analysis are used to enforce one-person-one-vote compliance.{"\n"}
            • All results are verified server-side before publication.{"\n"}
            • Any attempt to manipulate, hack, or interfere with the voting system will result in immediate disqualification and referral to law enforcement.
          </Text>

          <SectionHeader title="6. Election Administration" />
          <Text style={styles.text}>
            • Election administrators are responsible for configuring categories, deadlines, and eligibility rules.{"\n"}
            • eVoting System Pro Limited is not responsible for disputes from improperly configured elections.{"\n"}
            • Administrators must comply with all applicable laws when conducting elections on this platform.{"\n"}
            • Published results are considered final unless formally challenged within 48 hours through proper dispute channels.
          </Text>

          <SectionHeader title="7. Prohibited Conduct" />
          <Text style={styles.text}>
            Users must not:{"\n"}
            • Cast votes on behalf of another person without explicit legal authorization{"\n"}
            • Use bots, scripts, or automated tools to manipulate votes or results{"\n"}
            • Attempt to access, alter, copy, or delete other users' data{"\n"}
            • Share login credentials or voting access with any third party{"\n"}
            • Engage in vote buying, voter coercion, or any form of electoral fraud{"\n"}
            • Post harmful, defamatory, or illegal content on the platform{"\n"}
            • Reverse-engineer, decompile, or tamper with the platform's source code{"\n\n"}
            Violations will result in immediate account suspension and potential legal proceedings.
          </Text>

          <SectionHeader title="8. Result Publication" />
          <Text style={styles.text}>
            • Results are published in real-time or post-closure based on election configuration.{"\n"}
            • Aggregate results are public; individual voting choices remain strictly confidential.{"\n"}
            • eVoting System Pro Limited reserves the right to withhold or delay results pending fraud investigations.{"\n"}
            • All result disputes must be formally raised within 48 hours of publication via the designated dispute channel.
          </Text>

          <SectionHeader title="9. Intellectual Property" />
          <Text style={styles.text}>
            All platform content, branding, algorithms, UI designs, and software are the
            exclusive intellectual property of eVoting System Pro Limited. You may not
            copy, reproduce, distribute, or create derivative works without prior written permission.
          </Text>

          <SectionHeader title="10. Limitation of Liability" />
          <Text style={styles.text}>
            eVoting System Pro Limited shall not be liable for:{"\n"}
            • Technical failures or outages beyond our reasonable control{"\n"}
            • Losses arising from unauthorized account access due to user negligence{"\n"}
            • Errors in election configuration made by administrators{"\n"}
            • Any indirect, incidental, or consequential damages of any kind{"\n\n"}
            Our maximum aggregate liability is limited to fees paid by the user, if any.
          </Text>

          <SectionHeader title="11. Suspension & Termination" />
          <Text style={styles.text}>
            We reserve the right to suspend or permanently terminate accounts that:{"\n"}
            • Violate any provision of these Terms and Conditions{"\n"}
            • Engage in fraudulent voting or identity fraud{"\n"}
            • Provide false or misleading registration information{"\n"}
            • Attempt to compromise platform security or integrity{"\n\n"}
            Users may request voluntary account deletion at any time by contacting us.
          </Text>

          <SectionHeader title="12. Governing Law & Dispute Resolution" />
          <Text style={styles.text}>
            These Terms are governed exclusively by the laws of the Republic of Ghana.
            Any disputes arising from use of the platform shall first be resolved through
            good-faith negotiation between the parties. If unresolved within 30 days,
            disputes shall be submitted to the competent courts of Ghana for final resolution.
          </Text>

          <SectionHeader title="13. Contact Us" />
          <Text style={styles.text}>
            For questions, complaints, or legal notices:{"\n"}
            Email: stanleyafon@gmail.com{"\n"}
            Phone: +233 543 171 076{"\n"}
            Address: eVoting System Pro Limited, Ghana
          </Text>
        </View>

      </ScrollView>

      {/* ===== FIXED FOOTER ===== */}
      <View style={styles.fixedFooter}>
        <Text style={styles.footerText}>© 2026 eVoting System Pro</Text>
        <Text style={styles.footerSubText}>Empowering Communities to Vote with Precision</Text>
      </View>

    </ReusableScreen>
  );
}

/* ── Reusable section header component ── */
function SectionHeader({ title }: { title: string }) {
  return (
    <View style={styles.sectionHeaderRow}>
      <View style={styles.sectionHeaderDot} />
      <Text style={styles.sectionHeader}>{title}</Text>
    </View>
  );
}

/* ── Reusable meta row (label / value chip) ── */
function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scrollArea: {
    flex: 1,
    marginTop: 84,
    marginBottom: 66,
  },
  scrollContent: {
    padding: 16,
    paddingTop: 4,
    gap: 16,
  },

  /* ── Fixed Header ── */
  fixedHeader: {
    position: "absolute",
    top: 0, left: 0, right: 0,
    paddingTop: Platform.OS === "ios" ? 50 : 18,
    paddingBottom: 14,
    paddingHorizontal: 16,
    backgroundColor: T.brand,
    zIndex: 999,
    elevation: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: T.white,
    flex: 1,
  },
  subHeader: {
    fontSize: 12,
    color: "rgba(255,255,255,0.85)",
    marginTop: 2,
    fontWeight: "600",
    paddingLeft: 32,
  },

  /* ── Fixed Footer ── */
  fixedFooter: {
    position: "absolute",
    bottom: 0, left: 0, right: 0,
    paddingVertical: 12,
    backgroundColor: T.white,
    borderTopWidth: 1,
    borderTopColor: T.brandBorder,
    zIndex: 999,
    elevation: 6,
    alignItems: "center",
  },
  footerText: {
    color: T.brandDeeper,
    fontSize: 13,
    fontWeight: "700",
  },
  footerSubText: {
    color: T.inkMuted,
    fontSize: 11,
    marginTop: 2,
  },

  /* ── Section boxes ── */
  sectionBox: {
    backgroundColor: T.cardBg,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: T.brandBorder,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  sectionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  sectionIconWrap: {
    width: 34, height: 34,
    borderRadius: 10,
    backgroundColor: T.brandDeep,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionTitle: {
    fontSize: 19,
    fontWeight: "800",
    color: T.brandDeep,
    letterSpacing: 0.2,
  },
  titleDivider: {
    height: 1,
    backgroundColor: T.brandBorder,
    marginTop: 12,
    marginBottom: 14,
  },

  /* ── Meta info box ── */
  metaBox: {
    backgroundColor: T.brandLight,
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
    borderLeftWidth: 3,
    borderLeftColor: T.brand,
    gap: 6,
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  metaLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: T.brandDeep,
    marginRight: 4,
  },
  metaValue: {
    fontSize: 12.5,
    color: T.inkSoft,
    flexShrink: 1,
  },

  /* ── Section headers ── */
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 16,
    marginBottom: 6,
  },
  sectionHeaderDot: {
    width: 7, height: 7,
    borderRadius: 4,
    backgroundColor: T.brand,
  },
  sectionHeader: {
    fontSize: 14.5,
    fontWeight: "700",
    color: T.brandDeep,
  },

  /* ── Body text ── */
  text: {
    fontSize: 13.5,
    lineHeight: 22,
    color: T.inkSoft,
  },
  bold: {
    fontWeight: "700",
    color: T.ink,
  },
});