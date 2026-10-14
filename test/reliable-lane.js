"use strict";
const assert = require("assert");
const {
    createSendLane,
    createQueryLane,
    createOfflineQueue,
    suggestReconnect
} = require("../lib/Utils/reliable-lane");

async function testRepliesJumpAhead() {
    const order = [];
    let open = true;
    const lane = createSendLane({
        normalGapMs: 80,
        bulkGapMs: 80,
        replyGapMs: 0,
        burst: 1,
        jitterMs: 0,
        isOpen: () => open
    });
    await lane.enqueue({
        jid: "seed@s.whatsapp.net",
        content: { text: "seed" },
        options: { priority: "low" },
        run: async () => {}
    });
    const bulk = lane.enqueue({
        jid: "1@s.whatsapp.net",
        content: { text: "bulk" },
        options: { priority: "low" },
        run: async () => {
            order.push("bulk");
        }
    });
    await new Promise((r) => setTimeout(r, 5));
    const reply = lane.enqueue({
        jid: "2@s.whatsapp.net",
        content: { text: "hi" },
        options: { priority: "high" },
        run: async () => {
            order.push("reply");
        }
    });
    await Promise.all([bulk, reply]);
    assert.deepStrictEqual(order, ["reply", "bulk"]);
}

async function testNothingDropped() {
    const lane = createSendLane({
        normalGapMs: 0,
        replyGapMs: 0,
        bulkGapMs: 0,
        jitterMs: 0,
        isOpen: () => true
    });
    const results = await Promise.all(Array.from({ length: 25 }, (_, i) => lane.enqueue({
        jid: `${i}@s.whatsapp.net`,
        content: { text: String(i) },
        run: async () => i
    })));
    assert.strictEqual(results.length, 25);
    assert.strictEqual(lane.stats().dropped, 0);
    assert.strictEqual(lane.stats().sent, 25);
    assert.strictEqual(lane.stats().failed, 0);
}

async function testClosedDoesNotHang() {
    const lane = createSendLane({
        holdWhileOfflineMs: 80,
        isOpen: () => false
    });
    await assert.rejects(() => lane.enqueue({
        jid: "9@s.whatsapp.net",
        content: { text: "x" },
        run: async () => "nope"
    }), /Connection closed/);
    assert.strictEqual(lane.drainFailed().length, 1);
    assert.strictEqual(lane.stats().dropped, 0);
}

async function testQueryConcurrencyAndCoalesce() {
    let active = 0;
    let maxActive = 0;
    let calls = 0;
    const lane = createQueryLane({
        maxConcurrentQueries: 2,
        minQueryGapMs: 0,
        maxQueryRetries: 0
    });
    const node = { tag: "iq", attrs: { xmlns: "w:g2", type: "get", to: "a@g.us" }, content: [] };
    const run = () => lane.run(node, async () => {
        calls += 1;
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 40));
        active -= 1;
        return "ok";
    });
    const results = await Promise.all([run(), run(), run(), run()]);
    assert.deepStrictEqual(results, ["ok", "ok", "ok", "ok"]);
    assert.ok(maxActive <= 2, `max active ${maxActive}`);
    assert.strictEqual(calls, 1, "identical group metadata queries must coalesce");
    assert.ok(lane.stats().coalesced >= 3);
}

async function testNestedQueryDoesNotDeadlock() {
    const lane = createQueryLane({ maxConcurrentQueries: 1, minQueryGapMs: 0 });
    const outer = { tag: "iq", attrs: { xmlns: "encrypt", type: "get", to: "s.whatsapp.net" } };
    const inner = { tag: "iq", attrs: { xmlns: "privacy", type: "get", to: "s.whatsapp.net" } };
    const value = await lane.run(outer, async () => {
        return lane.run(inner, async () => "nested");
    });
    assert.strictEqual(value, "nested");
}

async function testOfflineQueueSurvivesThrow() {
    const seen = [];
    let open = true;
    const handlers = new Map([
        ["message", async (node) => {
            seen.push(node.id);
            if (node.id === "bad") throw new Error("boom");
        }]
    ]);
    const queue = createOfflineQueue({
        isOpen: () => open,
        onError: () => {},
        handlers
    });
    queue.enqueue("message", { id: "a" });
    queue.enqueue("message", { id: "bad" });
    queue.enqueue("message", { id: "c" });
    await new Promise((r) => setTimeout(r, 30));
    assert.deepStrictEqual(seen, ["a", "bad", "c"]);
    assert.strictEqual(queue.size(), 0);
}

async function testReconnectHint() {
    const loggedOut = suggestReconnect({ output: { statusCode: 401 } });
    assert.strictEqual(loggedOut.shouldReconnect, false);
    const lost = suggestReconnect({ output: { statusCode: 408 } });
    assert.strictEqual(lost.shouldReconnect, true);
    assert.ok(lost.delayMs >= 1500);
}

(async () => {
    await testRepliesJumpAhead();
    await testNothingDropped();
    await testClosedDoesNotHang();
    await testQueryConcurrencyAndCoalesce();
    await testNestedQueryDoesNotDeadlock();
    await testOfflineQueueSurvivesThrow();
    await testReconnectHint();
    console.log("reliable-lane tests passed");
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
