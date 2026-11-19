import assert from "node:assert/strict";
import { once } from "node:events";
import { after, test } from "node:test";
import { createTriageServer } from "./server.mjs";

const server = createTriageServer().listen(0, "127.0.0.1");
await once(server, "listening");
const endpoint = `http://127.0.0.1:${server.address().port}/api/triage`;

after(() => {
  const closed = once(server, "close");
  server.close();
  return closed;
});

async function post(body) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  return { httpStatus: response.status, payload: await response.json() };
}

const invalidInputs = [
  ["an empty body", ""],
  ["malformed JSON", '{"text":'],
  ["JSON null", "null"],
  ["a missing text field", "{}"],
  ["a non-string text field", '{"text":42}'],
  ["an empty string", '{"text":""}'],
  ["whitespace", JSON.stringify({ text: " \t\n " })],
];

for (const [name, body] of invalidInputs) {
  test(`rejects ${name}`, async () => {
    assert.deepEqual(await post(body), {
      httpStatus: 400,
      payload: { status: "invalid_input" },
    });
  });
}

const validTopics = [
  ["Когда будет доставка?", "delivery"],
  ["Уточните стоимость", "pricing"],
  ["Можно получить консультацию?", "other"],
];

for (const [text, topic] of validTopics) {
  test(`returns a ready draft for ${topic}`, async () => {
    assert.deepEqual(await post(JSON.stringify({ text })), {
      httpStatus: 200,
      payload: { status: "ready", topic, draft: "Спасибо за обращение. Уточним детали заявки." },
    });
  });
}

for (const marker of ["error", "bad-json", "bad-topic", "empty-draft", "timeout"]) {
  test(`returns manual review for [${marker}]`, async () => {
    const started = performance.now();
    const result = await post(JSON.stringify({ text: `[${marker}]` }));
    const elapsed = performance.now() - started;

    assert.deepEqual(result, {
      httpStatus: 200,
      payload: { status: "manual_review", topic: null, draft: null },
    });
    if (marker === "timeout") {
      // Allow scheduling overhead while checking that the 1.2 s mock delay is cut short.
      assert.ok(elapsed < 1_000, `Timeout response took ${Math.round(elapsed)} ms`);
    }
  });
}
