/**
 * Standalone smoke test for server.ts (Part 1 acceptance criteria).
 * Run: node --experimental-strip-types scripts/smoke-test.ts
 *
 * Uses a temp logs dir and port 0 (OS-assigned) so it never conflicts.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startLogServer, type LogPacket } from "../server.ts";

const validPacket: LogPacket = {
  log_id: "1698844392123-4",
  event_timestamp: "2023-11-01T14:53:12.123Z",
  level: "ERROR",
  source: { file: "auth_controller.py", line: 145, function: "validate_user_token" },
  message: "Failed to decrypt user token. Token length mismatch.",
  variables: { token_length: 12, expected_length: 256 },
  stack_trace: "Traceback (most recent call last):\n  ...",
};

async function post(port: number, body: string, method = "POST"): Promise<{ status: number; text: string; headers: Record<string, string> }> {
  const res = await fetch(`http://127.0.0.1:${port}/`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: method === "POST" ? body : undefined,
  });
  const text = await res.text();
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
  return { status: res.status, text, headers };
}

async function main(): Promise<void> {
  const logsDir = await mkdtemp(join(tmpdir(), "dbg-"));
  const received: LogPacket[] = [];
  const handle = await startLogServer({ port: 0, logsDir, bufferSize: 10 });
  handle.onPacket((p) => received.push(p));

  try {
    // 1. Valid POST -> 200 {"status":"success"}
    let r = await post(handle.port, JSON.stringify(validPacket));
    assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(r.text), { status: "success" });

    // 2. Malformed JSON -> 400
    r = await post(handle.port, "not json{");
    assert.equal(r.status, 400);

    // 3. Valid JSON but schema-invalid (missing required fields) -> 400
    r = await post(handle.port, JSON.stringify({}));
    assert.equal(r.status, 400);
    r = await post(handle.port, JSON.stringify({ log_id: "x", level: "INFO" })); // missing source/message/timestamp
    assert.equal(r.status, 400);

    // 4. Non-POST (GET) -> 405 with Allow: POST
    r = await post(handle.port, "", "GET");
    assert.equal(r.status, 405);
    assert.match(r.headers["allow"] ?? "", /POST/i);

    // 5. Second valid POST appends to the SAME file as a new JSONL line.
    r = await post(handle.port, JSON.stringify({ ...validPacket, log_id: "second" }));
    assert.equal(r.status, 200);

    // onPacket fired exactly for the 2 valid packets, in order.
    assert.equal(received.length, 2);
    assert.equal(received[0]!.log_id, "1698844392123-4");
    assert.equal(received[1]!.log_id, "second");

    // Log file: exactly 2 raw-JSON lines.
    const contents = await readFile(handle.logFile, "utf8");
    const lines = contents.trimEnd().split("\n");
    assert.equal(lines.length, 2);
    const parsed = lines.map((l) => JSON.parse(l));
    assert.equal(parsed[0]!.log_id, "1698844392123-4");
    assert.equal(parsed[1]!.log_id, "second");

    // 6. close() is idempotent; afterwards the port refuses connections.
    await handle.close();
    await handle.close();
    await assert.rejects(() => post(handle.port, JSON.stringify(validPacket)), /fetch failed|ECONNREFUSED/);

    // 7. log file lives under the supplied logs dir.
    assert.ok(handle.logFile.startsWith(logsDir + "/"), "log file under logs dir");

    console.log("OK: all Part 1 acceptance criteria passed.");
  } finally {
    await rm(logsDir, { recursive: true, force: true });
  }

  // Separate check: startLogServer itself creates a missing nested logs dir.
  const nested = join(await mkdtemp(join(tmpdir(), "dbg2-")), "deeply", "nested", "logs");
  const h2 = await startLogServer({ port: 0, logsDir: nested });
  const r2 = await post(h2.port, JSON.stringify(validPacket));
  assert.equal(r2.status, 200);
  assert.ok(h2.logFile.startsWith(nested + "/"), "nested logs dir auto-created");
  await h2.close();
  await rm(nested, { recursive: true, force: true });
  console.log("OK: missing logs dir auto-created.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
