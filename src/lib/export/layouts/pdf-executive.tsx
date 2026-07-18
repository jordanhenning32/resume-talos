import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import type { ParsedResume } from "../parse-resume";
import type { PdfDocumentMeta } from "./types";

const ACCENT = "#1a365d"; // deep navy

const styles = StyleSheet.create({
  page: {
    paddingTop: 44,
    paddingBottom: 44,
    paddingHorizontal: 56,
    fontFamily: "Helvetica",
    fontSize: 10.5,
    color: "#111111",
    lineHeight: 1.4,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginBottom: 6,
  },
  name: {
    fontSize: 26,
    fontFamily: "Helvetica-Bold",
    color: ACCENT,
    letterSpacing: 0.3,
  },
  contactLine: {
    fontSize: 9.5,
    color: "#555555",
    textAlign: "right",
    maxWidth: 240,
  },
  rule: {
    height: 2,
    backgroundColor: ACCENT,
    marginBottom: 12,
  },
  sectionHeader: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: ACCENT,
    textTransform: "uppercase",
    letterSpacing: 1.8,
    marginTop: 12,
    marginBottom: 2,
    paddingBottom: 3,
    borderBottomWidth: 0.7,
    borderBottomColor: "#888888",
  },
  summary: {
    marginTop: 4,
    fontSize: 10.5,
    lineHeight: 1.45,
  },
  roleHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 10,
    marginBottom: 1,
  },
  roleTitle: {
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
    color: "#111111",
  },
  roleCompany: {
    fontFamily: "Helvetica-Oblique",
    fontSize: 10.5,
    color: "#444444",
    marginBottom: 2,
  },
  roleDates: {
    fontSize: 10,
    color: "#555555",
    fontFamily: "Helvetica-Oblique",
  },
  bulletRow: {
    flexDirection: "row",
    marginLeft: 6,
    marginTop: 2,
  },
  bulletMarker: {
    width: 10,
    color: ACCENT,
    fontFamily: "Helvetica-Bold",
  },
  bulletText: {
    flex: 1,
    fontSize: 10.5,
  },
  paragraphBlock: {
    marginTop: 3,
  },
});

export function ExecutiveResumePdf({
  resume,
  pdfMeta,
}: {
  resume: ParsedResume;
  pdfMeta?: PdfDocumentMeta;
}) {
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
        <View style={styles.headerRow}>
          <Text style={styles.name}>{resume.name}</Text>
          {resume.contactLine && <Text style={styles.contactLine}>{resume.contactLine}</Text>}
        </View>
        <View style={styles.rule} />

        {resume.summary && (
          <View>
            <Text style={styles.sectionHeader}>Summary</Text>
            <Text style={styles.summary}>{resume.summary}</Text>
          </View>
        )}

        {resume.experience.length > 0 && (
          <View>
            <Text style={styles.sectionHeader}>Experience</Text>
            {resume.experience.map((role, i) => (
              <View key={i}>
                <View style={styles.roleHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.roleTitle}>{role.title}</Text>
                    {role.company && <Text style={styles.roleCompany}>{role.company}</Text>}
                  </View>
                  {role.dates && <Text style={styles.roleDates}>{role.dates}</Text>}
                </View>
                {role.bullets.map((b, j) => (
                  <View key={j} style={styles.bulletRow}>
                    <Text style={styles.bulletMarker}>›</Text>
                    <Text style={styles.bulletText}>{b}</Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
        )}

        {resume.otherSections.map((s, i) => (
          <View key={i}>
            <Text style={styles.sectionHeader}>{s.heading}</Text>
            {s.paragraphs.map((p, j) => (
              <Text key={j} style={styles.paragraphBlock}>
                {p}
              </Text>
            ))}
            {s.bullets.map((b, j) => (
              <View key={j} style={styles.bulletRow}>
                <Text style={styles.bulletMarker}>›</Text>
                <Text style={styles.bulletText}>{b}</Text>
              </View>
            ))}
          </View>
        ))}
      </Page>
    </Document>
  );
}
