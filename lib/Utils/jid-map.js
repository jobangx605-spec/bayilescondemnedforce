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

function applyMessageJid(msg, attrs = {}, meId) {
    if (!msg || !msg.key) return msg;
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
        const mapped = participantPn || resolvePn(key.participant) || (key.fromMe ? toPhoneJid(meId) : undefined);
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
    const ctx = msg.message
        && msg.message.extendedTextMessage
        && msg.message.extendedTextMessage.contextInfo;
    if (ctx && ctx.participant && String(ctx.participant).endsWith("@lid")) {
        const mapped = resolvePn(ctx.participant);
        if (mapped) {
            ctx.participantLid = ctx.participant;
            ctx.participant = mapped;
        }
    }
    return msg;
}

module.exports = {
    rememberLid,
    resolvePn,
    resolveLid,
    decodeJid,
    toPhoneJid,
    applyMessageJid,
    mapParticipant
};
