/**
 * A loopback Ollama server, so `barwise prompt eval` can be rehearsed
 * without an API key (docs/specs/offline-eval-rehearsal.spec.md).
 *
 * This sits beside `run.ts` because it is the same kind of thing: a way
 * to drive the real program, not a test of anything itself. Nothing in
 * barwise is stubbed -- the fake is the *server*, so the command builds
 * its own client from its own flags and the whole path downstream of
 * that is production code.
 *
 * The Ollama provider is the seam because it is the one that takes a
 * `--base-url`, speaks a documented NDJSON protocol over `fetch`, and
 * returns the extraction payload as bare content, which is exactly what
 * the recorded fixtures already hold.
 */
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";

/** How a served answer should end, mirroring Ollama's own vocabulary. */
export interface FakeAnswer {
  /** Raw payload to stream back as message content. */
  readonly content: string;
  /** "stop" when it finished, "length" when it hit the ceiling. */
  readonly doneReason?: string;
}

export interface FakeOllama {
  readonly url: string;
  /** Bodies of every request served, in order. */
  readonly requests: Array<Record<string, unknown>>;
  close(): Promise<void>;
}

/**
 * Start a server that answers `/api/chat`.
 *
 * `answer` is handed the user message so a test can pick a payload by
 * whatever it recognises in the transcript, and may return `undefined`
 * to fail the call -- which is how the incomplete-run path is reached.
 */
export async function startFakeOllama(
  answer: (userMessage: string, callIndex: number) => FakeAnswer | undefined,
): Promise<FakeOllama> {
  const requests: Array<Record<string, unknown>> = [];

  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      let parsed: { messages?: Array<{ role: string; content: string; }>; };
      try {
        parsed = JSON.parse(body) as typeof parsed;
      } catch {
        res.writeHead(400, { "content-type": "text/plain" });
        res.end("unparseable request");
        return;
      }
      requests.push(parsed as Record<string, unknown>);
      const user = parsed.messages?.find((m) => m.role === "user")?.content ?? "";
      const chosen = answer(user, requests.length - 1);
      if (chosen === undefined) {
        // 404 rather than 500, so the call fails on its first attempt.
        // The classifier reads the status off the error and treats 5xx
        // as transient, which is correct and costs three seconds of
        // real backoff per call -- nine seconds to assert something the
        // retry policy's own tests already cover. A terminal status
        // reaches the same incomplete run in a tenth of a second.
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("fake failure: no such model");
        return;
      }
      res.writeHead(200, { "content-type": "application/x-ndjson" });
      // Split across two chunks on a deliberately non-newline boundary.
      // The provider's reader carries a partial line forward, and
      // assuming a chunk boundary falls on a newline works right up
      // until a long generation -- which is exactly when it matters.
      const mid = Math.floor(chosen.content.length / 2);
      res.write(JSON.stringify({ message: { content: chosen.content.slice(0, mid) } }) + "\n");
      res.write(JSON.stringify({ message: { content: chosen.content.slice(mid) } }) + "\n");
      res.end(
        JSON.stringify({
          done: true,
          done_reason: chosen.doneReason ?? "stop",
          prompt_eval_count: 4000,
          eval_count: 3000,
        }) + "\n",
      );
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("fake ollama did not bind a port");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    async close() {
      // `fetch` pools connections, so `close()` alone waits on a socket
      // that is never coming back and the test process hangs after the
      // assertions pass -- a green suite that never exits, pointing
      // nowhere near its cause.
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/**
 * Match a request to an eval case by the first line of its transcript,
 * and answer with that case's recorded payload.
 *
 * A transcript edited without its fixture makes the match fail loudly
 * -- the server errors and the run reports failures -- rather than
 * quietly serving the wrong payload.
 */
export function fixtureAnswerer(
  evalsDir: string,
  fixturesDir: string,
  caseIds: readonly string[],
): (userMessage: string) => FakeAnswer | undefined {
  const firstLines = caseIds.map((id) => ({
    id,
    line: readFileSync(join(evalsDir, `${id}.transcript.md`), "utf8").split("\n")[0] ?? "",
  }));
  return (userMessage) => {
    const hit = firstLines.find((c) => c.line.length > 0 && userMessage.includes(c.line));
    if (hit === undefined) return undefined;
    return { content: readFileSync(join(fixturesDir, `${hit.id}.json`), "utf8") };
  };
}
