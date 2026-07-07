import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const FETCH_TIMEOUT_MS = 8000;
const CURL_TIMEOUT_SECONDS = 10;

const LIVE_FETCH_HEADERS = {
  "accept-language": "en-US,en;q=0.9",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
};

export function isBlockedResponse(payload: string): boolean {
  return /attention required|cloudflare|sorry, you have been blocked/i.test(payload);
}

async function fetchViaCurl(url: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "curl",
    [
      "-sL",
      "--max-time",
      String(CURL_TIMEOUT_SECONDS),
      "-A",
      LIVE_FETCH_HEADERS["user-agent"],
      "-H",
      `accept-language: ${LIVE_FETCH_HEADERS["accept-language"]}`,
      "-H",
      `accept: ${LIVE_FETCH_HEADERS.accept}`,
      url
    ],
    { timeout: FETCH_TIMEOUT_MS + 1000 }
  );
  if (isBlockedResponse(stdout)) {
    throw new Error(`Blocked by source protection for ${url}`);
  }
  if (!stdout) {
    throw new Error(`Fetch timed out for ${url}`);
  }
  return stdout;
}

export async function fetchLiveText(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: LIVE_FETCH_HEADERS,
      next: { revalidate: 300 },
      signal: controller.signal
    });

    const payload = await response.text();
    if (!response.ok) {
      throw new Error(`Fetch failed (${response.status}) for ${url}`);
    }
    if (isBlockedResponse(payload)) {
      throw new Error(`Blocked by source protection for ${url}`);
    }
    return payload;
  } catch (error) {
    try {
      return await fetchViaCurl(url);
    } catch {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Fetch timed out for ${url}`);
      }
      throw error;
    }
  } finally {
    clearTimeout(timeout);
  }
}
