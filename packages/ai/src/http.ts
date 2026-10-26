// One way to make a request to a model: with a time limit, no cookies, no
// referrer, and errors in plain words that never contain the API key. A
// reply comes whole (requestJson) or streamed line by line (streamLines).

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** How long a model may take to answer: small local models on a CPU can take a minute or more. */
export const ANSWER_TIMEOUT_MS = 180_000;
/** How long a "is it there?" check may take (Ollama on this computer answers in milliseconds). */
export const CHECK_TIMEOUT_MS = 3_000;

export interface PostOptions {
  fetch: Fetch;
  url: string;
  headers?: Record<string, string>;
  /** JSON body; GET when absent. */
  body?: unknown;
  timeoutMs: number;
  /** Who is being asked, for messages: "Ollama at http://localhost:11434". */
  who: string;
  /** Removed from every message, in case a provider echoes it back. */
  secret?: string;
}

const hide = (text: string, secret?: string) => (secret ? text.split(secret).join("[your key]") : text);

/**
 * Sends the request and gives back the response once its headers are in,
 * or a thrown Error in plain words. `read` reads the body while the time
 * limit still runs (timed with setTimeout, so tests can drive the clock);
 * a refused request (not 2xx) is read here and reported with the
 * provider's own message.
 */
async function send<T>(o: PostOptions, read: (response: Response) => Promise<T>): Promise<T> {
  const abort = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    abort.abort();
  }, o.timeoutMs);
  const late = () => new Error(`${o.who} didn't answer within ${Math.round(o.timeoutMs / 1000)} s`);
  try {
    let response: Response;
    try {
      response = await o.fetch(o.url, {
        method: o.body === undefined ? "GET" : "POST",
        headers: { ...(o.body === undefined ? {} : { "content-type": "application/json" }), ...o.headers },
        body: o.body === undefined ? undefined : JSON.stringify(o.body),
        signal: abort.signal,
        credentials: "omit",
        referrerPolicy: "no-referrer",
      });
    } catch (e) {
      if (timedOut) throw late();
      throw new Error(hide(`couldn't reach ${o.who}: ${e instanceof Error ? e.message : String(e)}`, o.secret));
    }
    try {
      if (!response.ok) throw new Error(hide(`${o.who} refused the request (HTTP ${response.status}): ${errorText(await response.text())}`, o.secret));
      return await read(response);
    } catch (e) {
      if (timedOut) throw late();
      throw e instanceof Error ? new Error(hide(e.message, o.secret)) : e;
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The parsed JSON reply, or a thrown Error saying what went wrong in plain
 * words. Gives up after `timeoutMs`.
 */
export async function requestJson(o: PostOptions): Promise<unknown> {
  return send(o, async (response) => {
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`${o.who} sent a reply that isn't JSON: ${text.slice(0, 80)}`);
    }
  });
}

/**
 * A streamed reply, line by line as it arrives (AI5c2): Ollama sends one
 * JSON object per line, hosted APIs send server-sent events ("data: …"
 * lines). `onLine` gets each line without its line ending; an error it
 * throws stops the reply and is reported like any other (with the key
 * hidden). The same time limit as requestJson covers the whole answer. A
 * response with no readable body is read whole and split the same way.
 */
export async function streamLines(o: PostOptions, onLine: (line: string) => void): Promise<void> {
  return send(o, async (response) => {
    let rest = "";
    const take = (chunk: string) => {
      rest += chunk;
      const lines = rest.split("\n");
      rest = lines.pop()!;
      for (const line of lines) onLine(line.replace(/\r$/, ""));
    };
    if (!response.body) take(await response.text());
    else {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        take(decoder.decode(value, { stream: true }));
      }
      take(decoder.decode());
    }
    if (rest !== "") onLine(rest.replace(/\r$/, ""));
  });
}

/** The provider's own error message when it sends one ({"error": {"message"}} or {"error": "…"}), else the start of the body. */
function errorText(body: string): string {
  try {
    const e = (JSON.parse(body) as { error?: unknown }).error;
    if (typeof e === "string") return e;
    if (e && typeof (e as { message?: unknown }).message === "string") return (e as { message: string }).message;
  } catch {
    // not JSON
  }
  return body.slice(0, 200) || "no details given";
}
