"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
// Defaults finishes Utils before WABinary re-enters it. Composer-first hits that cycle.
require("../lib/Defaults");
const { generateTableContent, generateCodeBlockContent, tokenizeCode, RichSubMessageType } = require("../lib/Utils/message-composer");
const { classifyDisconnect } = require("../lib/Utils/classify-disconnect");
const { RateLimiter } = require("../lib/Utils/rate-limiter");
const { USyncUsernameProtocol } = require("../lib/WAUSync/Protocols/USyncUsernameProtocol");
const { USyncUser } = require("../lib/WAUSync/USyncUser");
const { USyncQuery } = require("../lib/WAUSync/USyncQuery");
const { USyncContactProtocol } = require("../lib/WAUSync/Protocols/USyncContactProtocol");
const { buildVerdict, normalizeJidTarget } = require("../lib/Socket/ban-checker");
const { LIDMappingStore } = require("../lib/Signal/lid-mapping");
const { suggestReconnect } = require("../lib/Utils/reliable-lane");

const table = generateTableContent("Absen", ["Nama"], [["Jojo"]]);
assert.strictEqual(table.message.botForwardedMessage.message.richResponseMessage.submessages[0].messageType, RichSubMessageType.TABLE);
assert.ok(table.messageId);

const code = generateCodeBlockContent("const n = 1\n// note", null, { language: "javascript" });
const blocks = code.message.botForwardedMessage.message.richResponseMessage.submessages[0].codeMetadata.codeBlocks;
assert.ok(blocks.some((block) => block.highlightType === 1));
assert.ok(tokenizeCode("return 1", "javascript").length > 0);

assert.strictEqual(classifyDisconnect(428).shouldReconnect, true);
assert.strictEqual(classifyDisconnect(440).category, "fatal");
assert.strictEqual(classifyDisconnect(401).shouldReconnect, false);
assert.strictEqual(suggestReconnect({ output: { statusCode: 428 } }).shouldReconnect, true);
assert.strictEqual(suggestReconnect({ output: { statusCode: 440 } }).shouldReconnect, false);

const limiter = new RateLimiter({ minDelayMs: 0, maxDelayMs: 0, newChatDelayMs: 0, burstAllowance: 1 });
limiter.getDelay("6281@s.whatsapp.net", "").then((delay) => {
    assert.strictEqual(delay, 0);
    limiter.record("6281@s.whatsapp.net", "");
    assert.strictEqual(limiter.getStats().knownChats, 1);
    const sendSrc = fs.readFileSync(path.join(__dirname, "../lib/Socket/messages-send.js"), "utf8");
    assert.ok(!/rateLimiter\.(getDelay|reserve)/.test(sendSrc), "sends must not auto-delay");
    const kelvinSrc = fs.readFileSync(path.join(__dirname, "../lib/Socket/kelvin.js"), "utf8");
    const albumV2 = kelvinSrc.slice(kelvinSrc.indexOf("async handleAlbumV2"), kelvinSrc.indexOf("async handleEvent"));
    assert.ok(albumV2.includes("albumMessage"));
    assert.ok(!/forwardingScore|delay\(120\)|newsletterJid|disappearingMode|labels:/.test(albumV2));
    return runRest();
}).catch((err) => {
    console.error(err);
    process.exit(1);
});

function runRest() {

const protocol = new USyncUsernameProtocol();
assert.strictEqual(protocol.name, "username");
assert.strictEqual(protocol.getQueryElement().tag, "username");
assert.strictEqual(protocol.getUserElement(), null);
assert.strictEqual(protocol.parser({ tag: "username", attrs: {}, content: Buffer.from("jojo") }), "jojo");

const query = new USyncQuery().withUsernameProtocol().withContactProtocol();
assert.ok(query.protocols.some((item) => item.name === "username"));
const user = new USyncUser().withUsername("jojo").withUsernameKey("1234");
const contact = new USyncContactProtocol().getUserElement(user);
assert.strictEqual(contact.attrs.username, "jojo");
assert.strictEqual(contact.attrs.pin, "1234");

assert.strictEqual(normalizeJidTarget("+62 812-3456-7890"), "6281234567890");
assert.strictEqual(normalizeJidTarget("12"), null);
const banned = buildVerdict("6281234567890", { devices: 1, registry: true, page: { ok: true, generic: true, title: null } });
assert.strictEqual(banned.status, "BANNED");
const active = buildVerdict("6281234567890", { devices: 2, registry: true, page: { ok: true, generic: false, title: "Jojo" } });
assert.strictEqual(active.status, "ACTIVE");

(async () => {
    const saved = {};
    const keys = {
        async set(data) { Object.assign(saved, data["lid-mapping"]); },
        async get(type, ids) {
            const out = {};
            for (const id of ids) out[id] = saved[id];
            return out;
        }
    };
    const store = new LIDMappingStore(keys);
    await store.storeLIDPNMappings([{ lid: "111@lid", pn: "628111@s.whatsapp.net" }]);
    assert.strictEqual(await store.getPNForLID("111@lid"), "628111@s.whatsapp.net");
    assert.strictEqual(await store.getLIDForPN("628111@s.whatsapp.net"), "111@lid");
    console.log("cpx-port ok");
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
}
