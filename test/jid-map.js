"use strict";
const assert = require("assert");
const { applyMessageJid, rememberParticipants, decodeJid } = require("../lib/Utils/jid-map");

const priv = {
    key: { remoteJid: "111@lid", id: "A", fromMe: false },
    message: { conversation: ".menu" }
};
applyMessageJid(priv, { from: "111@lid", sender_pn: "628111@s.whatsapp.net" });
assert.strictEqual(priv.key.remoteJid, "628111@s.whatsapp.net");
assert.strictEqual(priv.sender, "628111@s.whatsapp.net");
assert.strictEqual(priv.key.remoteJidLid, "111@lid");
assert.strictEqual(priv.message.conversation, ".menu");

const group = {
    key: { remoteJid: "777@g.us", participant: "222@lid", id: "B", fromMe: false },
    message: {
        ephemeralMessage: {
            message: {
                extendedTextMessage: {
                    text: ".ping",
                    contextInfo: {
                        mentionedJid: ["333@lid", "628999@s.whatsapp.net"],
                        participant: "444@lid"
                    }
                }
            }
        }
    }
};
rememberParticipants([
    { id: "222@lid", phoneNumber: "628222@s.whatsapp.net" },
    { lid: "333@lid", jid: "628333@s.whatsapp.net" },
    { id: "444@lid", jid: "628444@s.whatsapp.net" }
]);
applyMessageJid(group, { participant: "222@lid" });
assert.strictEqual(group.key.remoteJid, "777@g.us");
assert.strictEqual(group.key.participant, "628222@s.whatsapp.net");
assert.strictEqual(group.sender, "628222@s.whatsapp.net");
assert.strictEqual(group.message.extendedTextMessage.text, ".ping");
assert.deepStrictEqual(group.message.extendedTextMessage.contextInfo.mentionedJid, ["628333@s.whatsapp.net", "628999@s.whatsapp.net"]);
assert.strictEqual(group.message.extendedTextMessage.contextInfo.participant, "628444@s.whatsapp.net");

const once = {
    key: { remoteJid: "628555@s.whatsapp.net", id: "C", fromMe: false },
    message: { viewOnceMessageV2: { message: { imageMessage: { caption: ".sticker" } } } }
};
applyMessageJid(once, {});
assert.strictEqual(once.isViewOnce, true);
assert.strictEqual(once.message.imageMessage.caption, ".sticker");

const button = {
    key: { remoteJid: "628555@s.whatsapp.net", id: "D", fromMe: false },
    message: {
        interactiveResponseMessage: {
            nativeFlowResponseMessage: { name: "menu", paramsJson: "{\"id\":\".owner\"}" }
        }
    }
};
applyMessageJid(button, {});
assert.strictEqual(button.message.buttonsResponseMessage.selectedButtonId, ".owner");
assert.strictEqual(button.message.interactiveResponseMessage, undefined);
assert.strictEqual(button.selectedButtonId, ".owner");

const unknown = {
    key: { remoteJid: "999@lid", id: "E", fromMe: false },
    message: { conversation: ".help" }
};
applyMessageJid(unknown, {});
assert.strictEqual(unknown.key.remoteJid, "999@lid");
assert.strictEqual(unknown.sender, "999@lid");
assert.strictEqual(decodeJid("628333@c.us"), "628333@s.whatsapp.net");

console.log("jid case map ok");
