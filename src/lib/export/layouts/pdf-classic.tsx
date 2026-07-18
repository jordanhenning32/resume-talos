import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import type { ParsedResume } from "../parse-resume";
import type { PdfDocumentMeta } from "./types";

const styles = StyleSheet.create({
  page: {
    paddingTop: 48,
    paddingBottom: 48,
    paddingHorizontal: 56,
    fontFamily: "Times-Roman",
    fontSize: 10.5,
    color: "#111111",
    lineHeight: 1.35,
  },
  name: {
    fontSize: 22,
    fontWeight: 700,
    fontFamily: "Times-Bold",
    textAlign: "center",
    letterSpacing: 0.5,
    lineHeight: 1.15,
    marginBottom: 6,
  },
  contactLine: {
    textAlign: "center",
    fontSize: 10,
    color: "#333333",
    lineHeight: 1.2,
  },
  hr: {
    marginTop: 12,
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#111111",
  },
  sectionHeader: {
    fontSize: 11,
    fontFamily: "Times-Bold",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 1.5,
    marginTop: 10,
    marginBottom: 4,
  },
  summary: {
    marginBottom: 2,
  },
  roleHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
    marginBottom: 1,
  },
  roleTitleCo: {
    fontFamily: "Times-Bold",
    fontSize: 10.5,
    flex: 1,
  },
  roleDates: {
    fontSize: 10,
    color: "#333333",
  },
  bulletRow: {
    flexDirection: "row",
    marginLeft: 8,
    marginTop: 1,
  },
  bulletMarker: {
    width: 10,
    fontSize: 10,
  },
  bulletText: {
    flex: 1,
    fontSize: 10.5,
  },
  paragraphBlock: {
    marginTop: 2,
  },
});

export function ClassicResumePdf({
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
        <Text style={styles.name}>{resume.name}</Text>
        {resume.contactLine && <Text style={styles.contactLine}>{resume.contactLine}</Text>}
        <View style={styles.hr} />

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
                  <Text style={styles.roleTitleCo}>
                    {role.title}
                    {role.company ? ` · ${role.company}` : ""}
                  </Text>
                  {role.dates && <Text style={styles.roleDates}>{role.dates}</Text>}
                </View>
                {role.bullets.map((b, j) => (
                  <View key={j} style={styles.bulletRow}>
                    <Text style={styles.bulletMarker}>•</Text>
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
                <Text style={styles.bulletMarker}>•</Text>
                <Text style={styles.bulletText}>{b}</Text>
              </View>
            ))}
          </View>
        ))}
      </Page>
    </Document>
  );
}
