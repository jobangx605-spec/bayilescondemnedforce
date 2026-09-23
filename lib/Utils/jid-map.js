"use strict";
/**
 * LID <-> phone JID map.
 * Bot cases usually compare 628xxx@s.whatsapp.net. WhatsApp now delivers @lid.
 * Encryption still uses the original address; this only rewrites the message key
 * the bot sees, and keeps the lid on remoteJidLid / participantLid.
 */
const pnByLid = new Map();
const lidByPn = new Map();

function userOf(jid) {
    if (!jid) return "";
    return String(jid).split("@")[0].split(":")[0].split("_")[0];
}

function toPhoneJid(value) {
    if (value === undefined || value === null || value === "") return undefined;
    let raw = String(value).trim();
    if (!raw || raw.endsWith("@lid")) return undefined;
    if (raw.endsWith("@c.us")) raw = raw.replace(/@c\.us$/, "@s.whatsapp.net");
    if (raw.includes("@")) {
        if (raw.endsWith("@s.whatsapp.net")) return `${userOf(raw)}@s.whatsapp.net`;
        return raw;
    }
    const digits = raw.replace(/\D/g, "");
    if (!digits) return undefined;
    return `${digits}@s.whatsapp.net`;
}

function toLidJid(value) {
    if (!value) return undefined;
    const raw = String(value);
    if (raw.endsWith("@lid")) return `${userOf(raw)}@lid`;
    if (raw.includes("@")) return undefined;
    const digits = raw.replace(/\D/g, "");
    return digits ? `${digits}@lid` : undefined;
}

function rememberLid(lid, pn) {
    const lidJid = toLidJid(lid) || (lid && String(lid).endsWith("@lid") ? `${userOf(lid)}@lid` : undefined);
    const phone = toPhoneJid(pn);
    if (!lidJid || !phone || !phone.endsWith("@s.whatsapp.net")) return;
    pnByLid.set(userOf(lidJid), phone);
    lidByPn.set(userOf(phone), lidJid);
}

function resolvePn(jid) {
    if (!jid) return undefined;
    const raw = String(jid);
    if (raw.endsWith("@s.whatsapp.net") || raw.endsWith("@c.us")) return toPhoneJid(raw);
    if (!raw.endsWith("@lid")) return undefined;
    return pnByLid.get(userOf(raw));
}

function resolveLid(jid) {
    if (!jid) return undefined;
    const raw = String(jid);
    if (raw.endsWith("@lid")) return `${userOf(raw)}@lid`;
    return lidByPn.get(userOf(raw));
}

function decodeJid(jid) {
    if (!jid) return jid;
    const raw = String(jid);
    if (raw.endsWith("@c.us")) return toPhoneJid(raw);
    if (raw.endsWith("@lid")) return resolvePn(raw) || `${userOf(raw)}@lid`;
    if (raw.endsWith("@s.whatsapp.net")) return `${userOf(raw)}@s.whatsapp.net`;
    if (!raw.includes("@")) {
        const phone = toPhoneJid(raw);
        return phone || raw;
    }
    return raw;
}

function mapParticipant(value, attrs) {
    if (!value) return value;
    const raw = String(value);
    if (!raw.endsWith("@lid")) return raw.endsWith("@c.us") ? toPhoneJid(raw) : raw;
    const fromAttrs = toPhoneJid(attrs && (attrs.participant_pn || attrs.sender_pn));
    return fromAttrs || resolvePn(raw) || raw;
}

function meParts(me) {
    if (!me) return { meId: undefined, meLid: undefined };
    if (typeof me === "string") return { meId: me, meLid: undefined };
    return { meId: me.id, meLid: me.lid };
}

function mapJidValue(value, meId, meLid) {
    if (!value) return value;
    const raw = String(value);
    if (raw.endsWith("@c.us")) return toPhoneJid(raw);
    if (!raw.endsWith("@lid")) return raw;
    if (meLid && userOf(raw) === userOf(meLid)) return toPhoneJid(meId) || raw;
    return resolvePn(raw) || raw;
}

function mapContextInfo(ctx, meId, meLid) {
    if (!ctx || typeof ctx !== "object") return;
    if (ctx.participant) {
        const mapped = mapJidValue(ctx.participant, meId, meLid);
        if (mapped && mapped !== ctx.participant && String(ctx.participant).endsWith("@lid")) {
            ctx.participantLid = String(ctx.participant);
            ctx.participant = mapped;
        }
        else if (mapped && String(ctx.participant).endsWith("@c.us")) {
            ctx.participant = mapped;
        }
    }
    if (Array.isArray(ctx.mentionedJid)) {
        ctx.mentionedJid = ctx.mentionedJid.map((jid) => mapJidValue(jid, meId, meLid));
    }
    if (ctx.remoteJid && String(ctx.remoteJid).endsWith("@lid")) {
        const mapped = mapJidValue(ctx.remoteJid, meId, meLid);
        if (mapped && !String(mapped).endsWith("@lid")) {
            ctx.remoteJidLid = String(ctx.remoteJid);
            ctx.remoteJid = mapped;
        }
    }
}

const CASE_WRAPPERS = [
    "ephemeralMessage",
    "viewOnceMessage",
    "viewOnceMessageV2",
    "viewOnceMessageV2Extension",
    "documentWithCaptionMessage",
    "editedMessage",
    "associatedChildMessage",
    "botInvokeMessage",
    "lottieStickerMessage",
    "groupStatusMentionMessage"
];

function visitMessage(message, meId, meLid, depth) {
    if (!message || typeof message !== "object" || Array.isArray(message) || depth > 8) return;
    if (message.contextInfo) {
        mapContextInfo(message.contextInfo, meId, meLid);
        if (message.contextInfo.quotedMessage) visitMessage(message.contextInfo.quotedMessage, meId, meLid, depth + 1);
    }
    for (const name of Object.keys(message)) {
        if (name === "contextInfo") continue;
        const value = message[name];
        if (!value || typeof value !== "object" || Array.isArray(value)) continue;
        if (value.contextInfo) visitMessage(value, meId, meLid, depth + 1);
        else if (value.message) visitMessage(value.message, meId, meLid, depth + 1);
    }
}

function buttonIdFromFlow(flow) {
    if (!flow) return "";
    let id = flow.name || "";
    const raw = flow.paramsJson || flow.params_json;
    if (raw) {
        try {
            const params = typeof raw === "string" ? JSON.parse(raw) : raw;
            id = params.id || params.selected_id || params.selectedId || params.selected_row_id || params.selectedRowId || params.button_id || id;
        }
        catch (err) {}
    }
    return id ? String(id) : "";
}

function exposeCaseMessage(msg, me) {
    if (!msg || !msg.message) return msg;
    const { meId, meLid } = meParts(me);
    let current = msg.message;
    let viewOnce = false;
    for (let i = 0; i < 6; i++) {
        let peeled = null;
        let wrapper = null;
        for (const name of CASE_WRAPPERS) {
            const node = current[name];
            if (node && node.message) {
                peeled = node.message;
                wrapper = name;
                break;
            }
        }
        if (!peeled) break;
        if (wrapper && wrapper.indexOf("viewOnce") === 0) viewOnce = true;
        current = peeled;
    }
    if (current !== msg.message) msg.message = current;
    if (viewOnce) msg.isViewOnce = true;
    const flow = current.interactiveResponseMessage && current.interactiveResponseMessage.nativeFlowResponseMessage;
    const buttonId = buttonIdFromFlow(flow);
    if (buttonId && !current.buttonsResponseMessage) {
        msg.selectedButtonId = buttonId;
        msg.nativeFlow = {
            name: flow && flow.name,
            paramsJson: flow && (flow.paramsJson || flow.params_json),
            id: buttonId
        };
        current.buttonsResponseMessage = {
            selectedButtonId: buttonId,
            selectedDisplayText: buttonId
        };
        delete current.interactiveResponseMessage;
    }
    const listId = current.listResponseMessage
        && current.listResponseMessage.singleSelectReply
        && current.listResponseMessage.singleSelectReply.selectedRowId;
    if (listId) msg.selectedButtonId = msg.selectedButtonId || String(listId);
    const plainId = current.buttonsResponseMessage && current.buttonsResponseMessage.selectedButtonId;
    if (plainId) msg.selectedButtonId = String(plainId);
    const templateId = current.templateButtonReplyMessage && current.templateButtonReplyMessage.selectedId;
    if (templateId) msg.selectedButtonId = msg.selectedButtonId || String(templateId);
    visitMessage(current, meId, meLid, 0);
    return msg;
}

function rememberParticipants(participants) {
    if (!Array.isArray(participants)) return;
    for (const person of participants) {
        if (!person) continue;
        const lid = person.lid || person.id;
        const phone = person.phoneNumber || person.jid;
        rememberLid(lid, phone);
    }
}

function applyMessageJid(msg, attrs = {}, me) {
    if (!msg || !msg.key) return msg;
    const { meId, meLid } = meParts(me);
    if (meId && meLid) rememberLid(meLid, meId);
    const key = msg.key;
    const senderPn = toPhoneJid(attrs.sender_pn) || toPhoneJid(attrs.peer_recipient_pn);
    const participantPn = toPhoneJid(attrs.participant_pn);
    if (attrs.from) rememberLid(attrs.from, senderPn);
    if (attrs.participant) rememberLid(attrs.participant, participantPn || senderPn);
    if (key.remoteJid && String(key.remoteJid).endsWith("@lid")) {
        key.remoteJidLid = `${userOf(key.remoteJid)}@lid`;
        rememberLid(key.remoteJidLid, senderPn);
    }
    if (key.participant && String(key.participant).endsWith("@lid")) {
        key.participantLid = `${userOf(key.participant)}@lid`;
        rememberLid(key.participantLid, participantPn || senderPn);
    }
    const remote = key.remoteJid ? String(key.remoteJid) : "";
    const isGroup = remote.endsWith("@g.us");
    const isStatus = remote.endsWith("@broadcast");
    const isNewsletter = remote.endsWith("@newsletter");
    if (!isGroup && !isStatus && !isNewsletter) {
        const pn = senderPn || resolvePn(key.remoteJidLid || remote) || (remote.endsWith("@c.us") ? toPhoneJid(remote) : undefined);
        if (pn) {
            key.remoteJidPn = pn;
            key.remoteJid = pn;
        }
        else if (remote.endsWith("@c.us")) {
            key.remoteJid = toPhoneJid(remote);
        }
    }
    if (key.participant) {
        const isMe = !!(meLid && userOf(key.participant) === userOf(meLid));
        const mapped = participantPn
            || resolvePn(key.participant)
            || (isMe || (key.fromMe && !meLid) ? toPhoneJid(meId) : undefined);
        if (String(key.participant).endsWith("@lid") && mapped) {
            key.participantPn = mapped;
            key.participant = mapped;
        }
        else if (participantPn) {
            key.participantPn = participantPn;
            key.participant = participantPn;
        }
        else if (String(key.participant).endsWith("@c.us")) {
            key.participant = toPhoneJid(key.participant);
        }
    }
    key.sender = key.participant || key.remoteJid;
    msg.sender = key.sender;
    if (key.participant) msg.participant = key.participant;
    try {
        exposeCaseMessage(msg, me);
    }
    catch (err) {}
    return msg;
}

module.exports = {
    rememberLid,
    resolvePn,
    resolveLid,
    decodeJid,
    toPhoneJid,
    applyMessageJid,
    mapParticipant,
    exposeCaseMessage,
    rememberParticipants
};
