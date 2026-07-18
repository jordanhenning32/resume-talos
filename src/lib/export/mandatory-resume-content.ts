export const MANDATORY_FAC_PPM_IT_CERTIFICATION =
  "FAC-P/PM-IT (Federal Acquisition Certification for Program and Project Managers - Information Technology), lapsed";
export const MANDATORY_FAC_PPM_IT_FACT_ID = "candidate-fac-ppm-it-lapsed";

const FAC_PPM_IT_PRESENT_RE =
  /FAC\s*[-/]?\s*P\s*\/?\s*PM\s*[-/]?\s*IT\b|FAC\s*\/\s*PPM\s*[-/]?\s*IT\b/i;
const FEDERAL_ACQUISITION_RE = /Federal Acquisition Certification/i;
const LAPSED_STATUS_RE = /\b(lapsed|previously held|expired)\b/i;

const FAC_PPM_IT_LINE_RE =
  /^(\s*(?:[-*]\s+)?)(?:FAC\s*[-/]?\s*P\s*\/?\s*PM\s*[-/]?\s*IT\b|FAC\s*\/\s*PPM\s*[-/]?\s*IT\b)[^\n]*$/gim;
const FAC_PPM_GENERIC_LINE_RE =
  /^(\s*(?:[-*]\s+)?)FAC\s*-\s*P\s*\/\s*PM\s*$/gim;

export function ensureMandatoryResumeContent(markdown: string): string {
  return ensureMandatoryFacPpmItCertification(markdown);
}

export function ensureMandatoryResumeCitedFactIds(
  citedFactIds: string[] | null | undefined,
): string[] {
  return Array.from(
    new Set([...(citedFactIds ?? []), MANDATORY_FAC_PPM_IT_FACT_ID]),
  );
}

export function ensureMandatoryFacPpmItCertification(markdown: string): string {
  if (!markdown.trim()) return markdown;

  const output = markdown
    .replace(FAC_PPM_IT_LINE_RE, (_line, marker: string) =>
      certificationLine(marker),
    )
    .replace(FAC_PPM_GENERIC_LINE_RE, (_line, marker: string) =>
      certificationLine(marker),
    );

  if (hasMandatoryFacPpmItCertification(output)) return output;
  return insertCertificationBullet(output, MANDATORY_FAC_PPM_IT_CERTIFICATION);
}

function hasMandatoryFacPpmItCertification(markdown: string): boolean {
  return (
    FAC_PPM_IT_PRESENT_RE.test(markdown) &&
    FEDERAL_ACQUISITION_RE.test(markdown) &&
    LAPSED_STATUS_RE.test(markdown)
  );
}

function certificationLine(marker: string): string {
  const prefix = marker && marker.trim().length > 0 ? marker : "- ";
  return `${prefix}${MANDATORY_FAC_PPM_IT_CERTIFICATION}`;
}

function insertCertificationBullet(markdown: string, bullet: string): string {
  const renderedBullet = `- ${bullet}`;
  const certHeader = /^##\s+Certifications\s*$/im.exec(markdown);
  if (certHeader) {
    const insertAt = certHeader.index + certHeader[0].length;
    return `${markdown.slice(0, insertAt)}\n${renderedBullet}${markdown.slice(
      insertAt,
    )}`;
  }

  const clearancesHeader = /^##\s+Clearances\s*$/im.exec(markdown);
  if (clearancesHeader) {
    const before = markdown.slice(0, clearancesHeader.index).trimEnd();
    const after = markdown.slice(clearancesHeader.index).trimStart();
    return `${before}\n\n## Certifications\n${renderedBullet}\n\n${after}`;
  }

  return `${markdown.trimEnd()}\n\n## Certifications\n${renderedBullet}`;
}
