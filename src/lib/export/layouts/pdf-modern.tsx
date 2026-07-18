import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import type { ParsedResume, ResumeSection } from "../parse-resume";
import type { PdfDocumentMeta } from "./types";

const ACCENT = "#0f4c5c"; // teal-charcoal
const SIDEBAR_BG = "#f4f6f8";

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#1a1a1a",
    lineHeight: 1.4,
  },
  // Full-width header — name + contact above the two-column body. Keeps
  // these critical identity tokens at the very top of the linearized PDF
  // text stream regardless of how an ATS parses the columns below.
  header: {
    paddingTop: 32,
    paddingBottom: 14,
    paddingHorizontal: 28,
  },
  name: {
    fontSize: 22,
    fontFamily: "Helvetica-Bold",
    color: ACCENT,
    letterSpacing: 0.4,
  },
  taglineRule: {
    height: 3,
    width: 44,
    backgroundColor: ACCENT,
    marginTop: 6,
    marginBottom: 8,
  },
  contactLine: {
    fontSize: 9.5,
    color: "#333333",
  },
  // Two-column body — main on LEFT (also first in DOM order, which is what
  // PDF text extraction follows). Sidebar on RIGHT, second in DOM. This
  // means an ATS reading the linearized stream sees Summary + Experience
  // BEFORE Skills / Certifications / Education — the correct resume
  // reading order.
  container: {
    flexDirection: "row",
    minHeight: "100%",
  },
  main: {
    flex: 1,
    paddingTop: 4,
    paddingBottom: 32,
    paddingLeft: 28,
    paddingRight: 16,
  },
  sidebar: {
    width: "32%",
    backgroundColor: SIDEBAR_BG,
    paddingTop: 24,
    paddingBottom: 32,
    paddingHorizontal: 22,
  },
  sidebarHeader: {
    fontSize: 10.5,
    fontFamily: "Helvetica-Bold",
    color: ACCENT,
    textTransform: "uppercase",
    letterSpacing: 1.3,
    marginTop: 14,
    marginBottom: 4,
  },
  sidebarItem: {
    fontSize: 9.5,
    marginTop: 2,
    color: "#222222",
  },
  mainSectionHeader: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: ACCENT,
    textTransform: "uppercase",
    letterSpacing: 1.6,
    marginTop: 4,
    marginBottom: 4,
  },
  summary: {
    fontSize: 10.5,
    lineHeight: 1.5,
    marginBottom: 8,
  },
  roleBlock: {
    marginTop: 8,
  },
  roleHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  roleTitle: {
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
  },
  roleCompany: {
    fontSize: 10,
    color: "#444444",
    marginTop: 1,
  },
  roleDates: {
    fontSize: 9.5,
    color: "#555555",
  },
  bulletRow: {
    flexDirection: "row",
    marginTop: 2,
  },
  bulletMarker: {
    width: 9,
    color: ACCENT,
    fontFamily: "Helvetica-Bold",
  },
  bulletText: {
    flex: 1,
    fontSize: 10,
  },
});

export function ModernResumePdf({
  resume,
  pdfMeta,
}: {
  resume: ParsedResume;
  pdfMeta?: PdfDocumentMeta;
}) {
  const sidebarSections: ResumeSection[] = [];
  const mainExtras: ResumeSection[] = [];
  for (const s of resume.otherSections) {
    const lower = s.heading.toLowerCase();
    if (
      lower.includes("skill") ||
      lower.includes("certif") ||
      lower.includes("educa") ||
      lower.includes("clear") ||
      lower.includes("award")
    ) {
      sidebarSections.push(s);
    } else {
      mainExtras.push(s);
    }
  }

  return (
    <Document
      title={pdfMeta?.title}
      author={pdfMeta?.author}
      subject={pdfMeta?.subject}
      keywords={pdfMeta?.keywords}
      creator={pdfMeta?.creator}
      producer={pdfMeta?.producer}
    >
      <Page size="LETTER" style={styles.page}>
        {/* Full-width header. Name + contact land at the top of the
            linearized PDF text stream regardless of how an ATS parses the
            two-column body below. */}
        <View style={styles.header}>
          <Text style={styles.name}>{resume.name}</Text>
          <View style={styles.taglineRule} />
          {resume.contactLine && (
            <Text style={styles.contactLine}>{resume.contactLine}</Text>
          )}
        </View>

        <View style={styles.container}>
          {/* Main column — FIRST in JSX so PDF text extraction reads
              Summary → Experience → other extras before the sidebar's
              Skills / Certs / Education. Visually on the left. */}
          <View style={styles.main}>
            {resume.summary && (
              <View>
                <Text style={styles.mainSectionHeader}>Summary</Text>
                <Text style={styles.summary}>{resume.summary}</Text>
              </View>
            )}

            {resume.experience.length > 0 && (
              <View>
                <Text style={styles.mainSectionHeader}>Experience</Text>
                {resume.experience.map((role, i) => (
                  <View key={i} style={styles.roleBlock}>
                    <View style={styles.roleHeader}>
                      <Text style={styles.roleTitle}>{role.title}</Text>
                      {role.dates && <Text style={styles.roleDates}>{role.dates}</Text>}
                    </View>
                    {role.company && (
                      <Text style={styles.roleCompany}>{role.company}</Text>
                    )}
                    {role.bullets.map((b, j) => (
                      <View key={j} style={styles.bulletRow}>
                        <Text style={styles.bulletMarker}>▪</Text>
                        <Text style={styles.bulletText}>{b}</Text>
                      </View>
                    ))}
                  </View>
                ))}
              </View>
            )}

            {mainExtras.map((s, i) => (
              <View key={i}>
                <Text style={styles.mainSectionHeader}>{s.heading}</Text>
                {s.paragraphs.map((p, j) => (
                  <Text key={j} style={{ marginTop: 3 }}>
                    {p}
                  </Text>
                ))}
                {s.bullets.map((b, j) => (
                  <View key={j} style={styles.bulletRow}>
                    <Text style={styles.bulletMarker}>▪</Text>
                    <Text style={styles.bulletText}>{b}</Text>
                  </View>
                ))}
              </View>
            ))}
          </View>

          {/* Sidebar — SECOND in JSX, visually on the right. Holds
              Skills / Certifications / Education / Awards / Clearances. */}
          <View style={styles.sidebar}>
            {sidebarSections.map((s, i) => (
              <View key={i}>
                <Text style={styles.sidebarHeader}>{s.heading}</Text>
                {s.paragraphs.map((p, j) => (
                  <Text key={j} style={styles.sidebarItem}>
                    {p}
                  </Text>
                ))}
                {s.bullets.map((b, j) => (
                  <Text key={j} style={styles.sidebarItem}>
                    • {b}
                  </Text>
                ))}
              </View>
            ))}
          </View>
        </View>
      </Page>
    </Document>
  );
}
