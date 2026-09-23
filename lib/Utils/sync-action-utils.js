"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emitSyncActionResults = exports.processContactAction = void 0;
const WABinary_1 = require("../WABinary");

const processContactAction = (action, id, logger) => {
    const results = [];
    if (!id) {
        if (logger && logger.warn) logger.warn({ action }, "contactAction sync: missing id");
        return results;
    }
    const lidJid = action.lidJid;
    const idIsPn = WABinary_1.isJidUser(id) || String(id).endsWith("@c.us");
    const phoneNumber = idIsPn ? id : action.pnJid || undefined;
    results.push({
        event: "contacts.upsert",
        data: [{
            id,
            name: action.fullName || action.firstName || action.username || undefined,
            username: action.username || undefined,
            lid: lidJid || undefined,
            phoneNumber
        }]
    });
    if (lidJid && WABinary_1.isLidUser(lidJid) && idIsPn) {
        results.push({ event: "lid-mapping.update", data: { lid: lidJid, pn: id } });
    }
    return results;
};
exports.processContactAction = processContactAction;

const emitSyncActionResults = (ev, results) => {
    for (const result of results || []) {
        ev.emit(result.event, result.data);
    }
};
exports.emitSyncActionResults = emitSyncActionResults;
