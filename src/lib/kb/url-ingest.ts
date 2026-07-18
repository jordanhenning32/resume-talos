import * as cheerio from "cheerio";
import { isIP } from "node:net";
import { ingestDocument, type DocumentKind, type IngestMode, type IngestResult } from "./ingest";
import type { SectionContext } from "./section-detect";

const USER_AGENT =
  "Mozilla/5.0 (Resume Talos KB Ingestor; +https://jordanhenning.com)";

const STRIP_SELECTORS = [
  "script",
  "style",
  "noscript",
  "nav",
  "header",
  "footer",
  "aside",
  "form",
  "[role=navigation]",
  "[role=banner]",
  "[role=contentinfo]",
  "[aria-hidden=true]",
];

const CONTENT_SELECTORS = ["main", "article", "[role=main]", "#content", ".content"];

const SKIP_EXTENSIONS = new Set([
  ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico",
  ".css", ".js", ".json", ".xml", ".zip", ".mp4", ".webm",
]);

const MAX_CRAWL_PAGES = 30;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_FETCH_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;

export type ExtractedPage = {
  url: string;
  title: string;
  text: string;
};

export async function fetchHtml(url: string): Promise<string> {
  const { response, text, finalUrl } = await fetchHtmlResult(url);
  assertHtmlContent(response, finalUrl);
  return text;
}

async function fetchHtmlResult(
  url: string,
): Promise<{ response: Response; text: string; finalUrl: string }> {
  return fetchTextSafely(
    url,
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  );
}

export function extractReadable(html: string, url: string): ExtractedPage {
  const $ = cheerio.load(html);
  const structured = extractStructuredJobPosting($);
  const metadataText = bestTextCandidate([
    structured?.text,
    $("meta[property='og:description']").attr("content"),
    $("meta[name='description']").attr("content"),
    $("meta[name='twitter:description']").attr("content"),
  ]);

  // Strip chrome and noise.
  for (const sel of STRIP_SELECTORS) $(sel).remove();

  const title =
    structured?.title ||
    $("meta[property='og:title']").attr("content")?.trim() ||
    $("meta[name='twitter:title']").attr("content")?.trim() ||
    $("title").first().text().trim() ||
    new URL(url).pathname ||
    url;

  // Prefer semantic main content if available; fall back to body.
  let rootSelector = "body";
  for (const sel of CONTENT_SELECTORS) {
    const cand = $(sel).first();
    if (cand.length > 0 && cand.text().trim().length > 200) {
      rootSelector = sel;
      break;
    }
  }
  const $root = $(rootSelector);

  // Convert block elements to text with newlines so paragraphs survive.
  $root.find("br").replaceWith("\n");
  $root.find("li").each((_, el) => {
    $(el).prepend("• ");
    $(el).append("\n");
  });
  for (const block of [
    "p", "h1", "h2", "h3", "h4", "h5", "h6",
    "div", "section", "article", "ul", "ol", "blockquote", "pre", "tr", "td",
  ]) {
    $root.find(block).each((_, el) => {
      $(el).append("\n");
    });
  }

  const raw = $root.text();
  const text = raw
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");

  return { url, title, text: metadataText && metadataText.length > text.length ? metadataText : text };
}

export async function fetchAndExtract(url: string): Promise<ExtractedPage> {
  const workdayPage = await fetchWorkdayJobPosting(url);
  if (workdayPage && workdayPage.text.trim().length >= 200) {
    return workdayPage;
  }

  const { response, text: html, finalUrl } = await fetchHtmlResult(url);
  assertHtmlContent(response, finalUrl);
  const page = extractReadable(html, finalUrl);
  if (page.text.trim().length >= 200) return page;

  if (finalUrl !== url) {
    const redirectedWorkdayPage = await fetchWorkdayJobPosting(finalUrl);
    if (
      redirectedWorkdayPage &&
      redirectedWorkdayPage.text.trim().length > page.text.trim().length
    ) {
      return redirectedWorkdayPage;
    }
  }

  return page;
}

function assertHtmlContent(response: Response, finalUrl: string): void {
  const ct = response.headers.get("content-type") ?? "";
  if (!ct.includes("html") && !ct.includes("xml")) {
    throw new Error(`Non-HTML content-type "${ct}" at ${finalUrl}`);
  }
}

type StructuredJobPosting = {
  title?: string;
  text: string;
};

function extractStructuredJobPosting(
  $: cheerio.CheerioAPI,
): StructuredJobPosting | null {
  const candidates: StructuredJobPosting[] = [];
  $("script[type='application/ld+json']").each((_, el) => {
    const raw = $(el).contents().text().trim();
    if (!raw) return;
    try {
      collectStructuredJobPostings(JSON.parse(raw), candidates);
    } catch {
      // Ignore malformed JSON-LD and fall back to meta tags/body text.
    }
  });
  return candidates.sort((a, b) => b.text.length - a.text.length)[0] ?? null;
}

function collectStructuredJobPostings(
  value: unknown,
  candidates: StructuredJobPosting[],
): void {
  if (Array.isArray(value)) {
    for (const item of value) collectStructuredJobPostings(item, candidates);
    return;
  }
  if (!isRecord(value)) return;

  collectStructuredJobPostings(value["@graph"], candidates);

  const description = stringValue(value.description);
  if (!description || !looksLikeJobPosting(value)) return;

  const text = htmlFragmentToText(description);
  if (!text) return;
  candidates.push({
    title: stringValue(value.title) ?? stringValue(value.name),
    text,
  });
}

function looksLikeJobPosting(value: Record<string, unknown>): boolean {
  const types = schemaTypes(value["@type"]);
  return (
    types.some((type) => type.toLowerCase() === "jobposting") ||
    Boolean(
      value.jobLocation ||
        value.hiringOrganization ||
        value.employmentType ||
        value.datePosted,
    )
  );
}

function schemaTypes(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return [];
}

async function fetchWorkdayJobPosting(url: string): Promise<ExtractedPage | null> {
  const cxsUrl = workdayCxsUrl(url);
  if (!cxsUrl) return null;

  try {
    const { text } = await fetchTextSafely(cxsUrl, "application/json,*/*;q=0.8");
    const data = JSON.parse(text);
    if (!isRecord(data) || !isRecord(data.jobPostingInfo)) return null;

    const info = data.jobPostingInfo;
    const title =
      stringValue(info.title) ??
      stringValue(info.jobPostingId) ??
      new URL(url).pathname;
    const description = stringValue(info.jobDescription);
    const body = description ? htmlFragmentToText(description) : "";
    if (!body) return null;

    const organization = isRecord(data.hiringOrganization)
      ? stringValue(data.hiringOrganization.name)
      : undefined;
    const additionalLocations = Array.isArray(info.additionalLocations)
      ? info.additionalLocations.filter(
          (location): location is string => typeof location === "string",
        )
      : [];
    const locationText = [stringValue(info.location), ...additionalLocations]
      .filter(Boolean)
      .join("; ");
    const metadata = [
      organization ? `Company: ${organization}` : undefined,
      locationText ? `Location: ${locationText}` : undefined,
      stringValue(info.timeType) ? `Time type: ${stringValue(info.timeType)}` : undefined,
      stringValue(info.remoteType) ? `Workplace type: ${stringValue(info.remoteType)}` : undefined,
      stringValue(info.jobReqId) ? `Req ID: ${stringValue(info.jobReqId)}` : undefined,
      stringValue(info.postedOn) ? `Posted: ${stringValue(info.postedOn)}` : undefined,
    ].filter((line): line is string => Boolean(line));

    return {
      url: stringValue(info.externalUrl) ?? url,
      title,
      text: normalizeExtractedText([title, ...metadata, body].join("\n\n")),
    };
  } catch {
    return null;
  }
}

function workdayCxsUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = assertSafeFetchUrl(url);
  } catch {
    return null;
  }

  const hostMatch = parsed.hostname.match(/^([a-z0-9-]+)\.wd\d+\.myworkdayjobs\.com$/i);
  if (!hostMatch) return null;

  const parts = parsed.pathname.split("/").filter(Boolean);
  const jobIndex = parts.findIndex((part) => part.toLowerCase() === "job");
  if (jobIndex < 1 || jobIndex >= parts.length - 1) return null;

  const tenant = hostMatch[1];
  const site = parts[jobIndex - 1];
  const jobPath = parts.slice(jobIndex).join("/");
  return `${parsed.origin}/wday/cxs/${tenant}/${site}/${jobPath}`;
}

function bestTextCandidate(candidates: Array<string | null | undefined>): string | null {
  const normalized = candidates
    .map((candidate) => (candidate ? htmlFragmentToText(candidate) : ""))
    .filter((candidate) => candidate.length > 0);
  return normalized.sort((a, b) => b.length - a.length)[0] ?? null;
}

function htmlFragmentToText(html: string): string {
  const $ = cheerio.load(`<main>${html}</main>`);
  const $root = $("main");
  $root.find("br").replaceWith("\n");
  $root.find("li").each((_, el) => {
    $(el).prepend("- ");
    $(el).append("\n");
  });
  for (const block of [
    "p", "h1", "h2", "h3", "h4", "h5", "h6",
    "div", "section", "article", "ul", "ol", "blockquote", "pre", "tr", "td",
  ]) {
    $root.find(block).each((_, el) => {
      $(el).append("\n");
    });
  }
  return normalizeExtractedText($root.text());
}

function normalizeExtractedText(raw: string): string {
  return raw
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export async function discoverUrls(seed: string): Promise<string[]> {
  const seedUrl = assertSafeFetchUrl(seed);
  const origin = seedUrl.origin;
  const seen = new Set<string>();

  // Try sitemap.xml first.
  try {
    const sitemap = await fetchTextSafely(`${origin}/sitemap.xml`, "application/xml,text/xml,*/*");
    if (sitemap.response.ok) {
      const xml = sitemap.text;
      const $ = cheerio.load(xml, { xmlMode: true });
      const locs: string[] = [];
      $("loc").each((_, el) => {
        const u = $(el).text().trim();
        if (u) locs.push(u);
      });
      // Sitemap may be an index — gather child sitemaps too.
      const childSitemaps = locs.filter((u) => u.endsWith(".xml"));
      for (const childUrl of childSitemaps) {
        try {
          const child = await fetchTextSafely(childUrl, "application/xml,text/xml,*/*");
          if (child.response.ok) {
            const childXml = child.text;
            const $$ = cheerio.load(childXml, { xmlMode: true });
            $$("loc").each((_, el) => {
              const u = $$(el).text().trim();
              if (u) locs.push(u);
            });
          }
        } catch {
          // Ignore individual sitemap failures.
        }
      }
      for (const u of locs) {
        if (isCrawlable(u, origin)) seen.add(normalizeUrl(u));
      }
      if (seen.size > 0) {
        return Array.from(seen).slice(0, MAX_CRAWL_PAGES);
      }
    }
  } catch {
    // Sitemap missing or failed — fall through to homepage crawl.
  }

  // Fallback: fetch the seed page and harvest same-origin links.
  try {
    const html = await fetchHtml(seed);
    const $ = cheerio.load(html);
    seen.add(normalizeUrl(seed));
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href");
      if (!href) return;
      let resolved: string;
      try {
        resolved = new URL(href, seed).toString();
      } catch {
        return;
      }
      if (isCrawlable(resolved, origin)) seen.add(normalizeUrl(resolved));
    });
  } catch {
    // Seed page failed entirely.
  }

  return Array.from(seen).slice(0, MAX_CRAWL_PAGES);
}

function isCrawlable(url: string, origin: string): boolean {
  let u: URL;
  try {
    u = assertSafeFetchUrl(url);
  } catch {
    return false;
  }
  if (u.origin !== origin) return false;
  const path = u.pathname.toLowerCase();
  for (const ext of SKIP_EXTENSIONS) {
    if (path.endsWith(ext)) return false;
  }
  return true;
}

export function assertSafeFetchUrl(url: string): URL {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("URL must use http:// or https://.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("URL credentials are not allowed.");
  }
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) {
    throw new Error("Localhost URLs are not allowed.");
  }
  if (isPrivateHost(host)) {
    throw new Error("Private or local network URLs are not allowed.");
  }
  return parsed;
}

async function fetchTextSafely(
  url: string,
  accept: string,
): Promise<{ response: Response; text: string; finalUrl: string }> {
  let current = assertSafeFetchUrl(url).toString();
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(current, {
        headers: {
          "user-agent": USER_AGENT,
          accept,
        },
        signal: controller.signal,
        redirect: "manual",
      });
      if (isRedirect(response.status)) {
        const location = response.headers.get("location");
        if (!location) throw new Error(`Redirect without Location at ${current}`);
        current = assertSafeFetchUrl(new URL(location, current).toString()).toString();
        continue;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${current}`);
      const contentLength = Number(response.headers.get("content-length") ?? "0");
      if (Number.isFinite(contentLength) && contentLength > MAX_FETCH_BYTES) {
        throw new Error(`Response too large (${contentLength} bytes, max ${MAX_FETCH_BYTES}).`);
      }
      const text = await response.text();
      const byteLength = new TextEncoder().encode(text).byteLength;
      if (byteLength > MAX_FETCH_BYTES) {
        throw new Error(`Response too large (${byteLength} bytes, max ${MAX_FETCH_BYTES}).`);
      }
      return { response, text, finalUrl: current };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`Too many redirects fetching ${url}.`);
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

function isPrivateHost(host: string): boolean {
  const normalized = host.replace(/^\[|\]$/g, "");
  const ipVersion = isIP(normalized);
  if (ipVersion === 4) return isPrivateIpv4(normalized);
  if (ipVersion === 6) return isPrivateIpv6(normalized);
  return false;
}

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isPrivateIpv6(host: string): boolean {
  const normalized = host.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    normalized === "::1" ||
    normalized === "::" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:")
  );
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    // Drop tracking params.
    for (const k of Array.from(u.searchParams.keys())) {
      if (k.startsWith("utm_") || k === "fbclid" || k === "gclid") {
        u.searchParams.delete(k);
      }
    }
    // Trailing-slash normalize on directory-style paths.
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.toString();
  } catch {
    return url;
  }
}

export type IngestUrlResult =
  | { url: string; status: "ingested"; result: IngestResult }
  | { url: string; status: "duplicate_document"; existingName: string; existingDocumentId: string }
  | { url: string; status: "empty"; reason: string }
  | { url: string; status: "error"; message: string };

export async function ingestUrl(
  url: string,
  opts?: {
    kind?: DocumentKind;
    mode?: IngestMode;
    sectionContext?: Omit<SectionContext, "charStart" | "charEnd">;
  },
): Promise<IngestUrlResult> {
  let page: ExtractedPage;
  try {
    page = await fetchAndExtract(url);
  } catch (err) {
    return {
      url,
      status: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }

  if (page.text.trim().length < 100) {
    return { url, status: "empty", reason: "page text under 100 chars after extraction" };
  }

  try {
    const result = await ingestDocument({
      name: page.title,
      fileType: "txt",
      buffer: Buffer.from(page.text, "utf-8"),
      sourcePath: page.url,
      kind: opts?.kind,
      mode: opts?.mode,
      extraMetadata: opts?.sectionContext
        ? {
            sectionContext: {
              ...opts.sectionContext,
              charStart: 0,
              charEnd: page.text.length,
            },
          }
        : undefined,
    });
    if (result.status === "duplicate_document" && result.duplicate) {
      return {
        url,
        status: "duplicate_document",
        existingName: result.duplicate.existingName,
        existingDocumentId: result.duplicate.existingDocumentId,
      };
    }
    return { url, status: "ingested", result };
  } catch (err) {
    return {
      url,
      status: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export type CrawlSummary = {
  seedUrl: string;
  totalUrlsDiscovered: number;
  perUrl: IngestUrlResult[];
  totalIngested: number;
  totalDuplicates: number;
  totalErrors: number;
  totalFactsAdded: number;
  totalCostUsd: number;
};

export async function ingestSite(
  seedUrl: string,
  opts?: {
    kind?: DocumentKind;
    mode?: IngestMode;
    sectionContext?: Omit<SectionContext, "charStart" | "charEnd">;
  },
): Promise<CrawlSummary> {
  const urls = await discoverUrls(seedUrl);
  const results: IngestUrlResult[] = [];
  let factsAdded = 0;
  let costUsd = 0;
  for (const u of urls) {
    const r = await ingestUrl(u, opts);
    results.push(r);
    if (r.status === "ingested") {
      factsAdded += r.result.factCount;
      costUsd += r.result.costUsd;
    }
  }
  return {
    seedUrl,
    totalUrlsDiscovered: urls.length,
    perUrl: results,
    totalIngested: results.filter((r) => r.status === "ingested").length,
    totalDuplicates: results.filter((r) => r.status === "duplicate_document").length,
    totalErrors: results.filter((r) => r.status === "error" || r.status === "empty").length,
    totalFactsAdded: factsAdded,
    totalCostUsd: Math.round(costUsd * 1_000_000) / 1_000_000,
  };
}
