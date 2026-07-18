import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import { format } from "date-fns";
import type { LayoutId, PdfDocumentMeta } from "./layouts/types";

type CoverLetterInput = {
  greeting: string | null;
  paragraphs: string[];
  signOff: string;
  name: string;
  contactLine?: string;
  candidateName?: string;
  layout: LayoutId;
  pdfMeta?: PdfDocumentMeta;
};

const stylesByLayout = {
  classic: StyleSheet.create({
    page: {
      paddingTop: 56,
      paddingBottom: 56,
      paddingHorizontal: 60,
      fontFamily: "Times-Roman",
      fontSize: 11,
      color: "#111111",
      lineHeight: 1.5,
    },
    header: { textAlign: "right", fontSize: 10.5, color: "#333333", marginBottom: 18 },
    candidateName: { fontFamily: "Times-Bold", fontSize: 16, marginBottom: 2, textAlign: "right" },
    date: { marginBottom: 24, fontSize: 10.5 },
    greeting: { marginBottom: 14 },
    paragraph: { marginBottom: 12, textAlign: "justify" },
    signOff: { marginTop: 16 },
    name: { fontFamily: "Times-Bold", marginTop: 18 },
  }),
  executive: StyleSheet.create({
    page: {
      paddingTop: 52,
      paddingBottom: 52,
      paddingHorizontal: 60,
      fontFamily: "Helvetica",
      fontSize: 11,
      color: "#111111",
      lineHeight: 1.55,
    },
    header: { textAlign: "right", fontSize: 10, color: "#555555", marginBottom: 14 },
    candidateName: { fontFamily: "Helvetica-Bold", fontSize: 18, color: "#1A365D", marginBottom: 2, textAlign: "right" },
    date: { marginBottom: 24, fontSize: 10.5, color: "#444444" },
    greeting: { marginBottom: 14 },
    paragraph: { marginBottom: 12, textAlign: "justify" },
    signOff: { marginTop: 16 },
    name: { fontFamily: "Helvetica-Bold", marginTop: 18, color: "#1A365D" },
  }),
  "modern-two-column": StyleSheet.create({
    page: {
      paddingTop: 56,
      paddingBottom: 56,
      paddingHorizontal: 64,
      fontFamily: "Helvetica",
      fontSize: 11,
      color: "#1a1a1a",
      lineHeight: 1.55,
    },
    header: { textAlign: "right", fontSize: 10, color: "#555555", marginBottom: 14 },
    candidateName: { fontFamily: "Helvetica-Bold", fontSize: 18, color: "#0F4C5C", marginBottom: 2, textAlign: "right" },
    date: { marginBottom: 24, fontSize: 10.5, color: "#444444" },
    greeting: { marginBottom: 14 },
    paragraph: { marginBottom: 12 },
    signOff: { marginTop: 16 },
    name: { fontFamily: "Helvetica-Bold", marginTop: 18, color: "#0F4C5C" },
  }),
} satisfies Record<LayoutId, ReturnType<typeof StyleSheet.create>>;

export function CoverLetterPdf(input: CoverLetterInput) {
  const s = stylesByLayout[input.layout];
  const meta = input.pdfMeta;
  return (
    <Document
      title={meta?.title}
      author={meta?.author}
      subject={meta?.subject}
      keywords={meta?.keywords}
      creator={meta?.creator}
      producer={meta?.producer}
    >
      <Page size="LETTER" style={s.page}>
        <View style={s.header}>
          <Text style={s.candidateName}>{input.candidateName ?? input.name}</Text>
          {input.contactLine && <Text>{input.contactLine}</Text>}
        </View>
        <Text style={s.date}>{format(new Date(), "PPP")}</Text>
        {input.greeting && <Text style={s.greeting}>{input.greeting}</Text>}
        {input.paragraphs.map((p, i) => (
          <Text key={i} style={s.paragraph}>
            {p}
          </Text>
        ))}
        <Text style={s.signOff}>{input.signOff}</Text>
        <Text style={s.name}>{input.name}</Text>
      </Page>
    </Document>
  );
}
