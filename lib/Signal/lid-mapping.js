"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LIDMappingStore = void 0;

function userOf(jid) {
    if (!jid) return "";
    return String(jid).split("@")[0].split(":")[0].split("_")[0];
}

function phoneJid(pn) {
    const user = userOf(pn);
    if (!user) return "";
    return `${user}@s.whatsapp.net`;
}

function lidJid(lid) {
    const user = userOf(lid);
    if (!user) return "";
    return `${user}@lid`;
}

class LIDMappingStore {
    constructor(keys, logger) {
        this.keys = keys;
        this.logger = logger;
        this.cache = new Map();
    }
    remember(lid, pn) {
        try {
            const jidMap = require("../Utils/jid-map");
            if (jidMap.rememberLid) jidMap.rememberLid(lidJid(lid), phoneJid(pn));
        }
        catch (_) { }
    }
    async storeLIDPNMappings(pairs) {
        if (!pairs || !pairs.length) return;
        const batch = {};
        for (const pair of pairs) {
            if (!pair || !pair.lid || !pair.pn) continue;
            const lidUser = userOf(pair.lid);
            const pnUser = userOf(pair.pn);
            if (!lidUser || !pnUser) continue;
            if (!String(pair.lid).includes("lid") && !String(pair.pn).includes("lid")) continue;
            const lid = String(pair.lid).includes("lid") ? lidUser : pnUser;
            const pn = String(pair.pn).includes("lid") ? lidUser : pnUser;
            batch[pn] = lid;
            batch[`${lid}_reverse`] = pn;
            this.cache.set(`pn:${pn}`, lid);
            this.cache.set(`lid:${lid}`, pn);
            this.remember(lid, pn);
        }
        if (!Object.keys(batch).length || !this.keys || typeof this.keys.set !== "function") return;
        await this.keys.set({ "lid-mapping": batch });
    }
    async lookup(kind, user) {
        const key = `${kind}:${user}`;
        if (this.cache.has(key)) return this.cache.get(key);
        if (!this.keys || typeof this.keys.get !== "function") return null;
        const id = kind === "pn" ? user : `${user}_reverse`;
        const stored = await this.keys.get("lid-mapping", [id]);
        const value = stored && stored[id];
        if (value && typeof value === "string") {
            if (kind === "pn") {
                this.cache.set(`pn:${user}`, value);
                this.cache.set(`lid:${value}`, user);
            }
            else {
                this.cache.set(`lid:${user}`, value);
                this.cache.set(`pn:${value}`, user);
            }
            return value;
        }
        return null;
    }
    async getLIDForPN(pn) {
        const user = userOf(pn);
        if (!user) return null;
        const lidUser = await this.lookup("pn", user);
        return lidUser ? lidJid(lidUser) : null;
    }
    async getPNForLID(lid) {
        const user = userOf(lid);
        if (!user) return null;
        const pnUser = await this.lookup("lid", user);
        if (pnUser) this.remember(user, pnUser);
        return pnUser ? phoneJid(pnUser) : null;
    }
    async getLIDsForPNs(pns) {
        const out = [];
        for (const pn of pns || []) {
            const lid = await this.getLIDForPN(pn);
            if (lid) out.push({ pn, lid });
        }
        return out.length ? out : null;
    }
    async getPNsForLIDs(lids) {
        const out = [];
        for (const lid of lids || []) {
            const pn = await this.getPNForLID(lid);
            if (pn) out.push({ lid, pn });
        }
        return out.length ? out : null;
    }
    close() {
        this.cache.clear();
    }
}
exports.LIDMappingStore = LIDMappingStore;
