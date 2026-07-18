import { assertSafeFetchUrl, fetchHtml } from "@/lib/kb/url-ingest";

const blocked = [
  "file:///etc/passwd",
  "http://localhost:3000",
  "http://127.0.0.1/admin",
  "http://10.0.0.5/internal",
  "http://172.16.0.1/internal",
  "http://192.168.1.10/internal",
  "http://169.254.169.254/latest/meta-data",
  "http://[::1]/",
];

for (const url of blocked) {
  let threw = false;
  try {
    assertSafeFetchUrl(url);
  } catch {
    threw = true;
  }
  if (!threw) throw new Error(`Expected URL to be blocked: ${url}`);
}

async function expectRejects(promise: Promise<unknown>, label: string) {
  let rejected = false;
  try {
    await promise;
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error(`Expected ${label} to reject.`);
}

async function main() {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () =>
      new Response("", {
        status: 302,
        headers: { location: "http://127.0.0.1/admin" },
      })) as typeof fetch;
    await expectRejects(fetchHtml("https://example.com"), "redirect to private URL");

    globalThis.fetch = (async () =>
      new Response("<html></html>", {
        status: 200,
        headers: {
          "content-type": "text/html",
          "content-length": String(3 * 1024 * 1024),
        },
      })) as typeof fetch;
    await expectRejects(fetchHtml("https://example.com"), "oversized response");
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log("PASS URL ingest blocks private targets, unsafe redirects, and oversized responses.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
