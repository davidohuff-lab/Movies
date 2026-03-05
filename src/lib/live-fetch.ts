import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

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
  const { stdout } = await execFileAsync("curl", [
    "-sL",
    "-A",
    LIVE_FETCH_HEADERS["user-agent"],
    "-H",
    `accept-language: ${LIVE_FETCH_HEADERS["accept-language"]}`,
    "-H",
    `accept: ${LIVE_FETCH_HEADERS.accept}`,
    url
  ]);
  if (isBlockedResponse(stdout)) {
    throw new Error(`Blocked by source protection for ${url}`);
  }
  return stdout;
}

export async function fetchLiveText(url: string): Promise<string> {
  try {
    const response = await fetch(url, {
      headers: LIVE_FETCH_HEADERS,
      next: { revalidate: 300 }
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
      throw error;
    }
  }
}
