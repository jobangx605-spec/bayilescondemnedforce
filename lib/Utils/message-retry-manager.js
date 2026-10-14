"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessageRetryManager = exports.RetryReason = void 0;

const RetryReason = {
    UnknownError: 0,
    SignalErrorNoSession: 1,
    SignalErrorInvalidKey: 2,
    SignalErrorInvalidKeyId: 3,
    SignalErrorInvalidMessage: 4,
    SignalErrorInvalidSignature: 5,
    SignalErrorFutureMessage: 6,
    SignalErrorBadMac: 7,
    SignalErrorInvalidSession: 8,
    SignalErrorInvalidMsgKey: 9
};
exports.RetryReason = RetryReason;
const MAC_ERROR_CODES = new Set([RetryReason.SignalErrorInvalidMessage, RetryReason.SignalErrorBadMac]);
const SEP = "\u0000";

class TtlMap {
    constructor(max, ttl) {
        this.max = max;
        this.ttl = ttl;
        this.map = new Map();
    }
    get(key) {
        const hit = this.map.get(key);
        if (!hit) return undefined;
        if (Date.now() - hit.at > this.ttl) {
            this.map.delete(key);
            return undefined;
        }
        return hit.value;
    }
    set(key, value) {
        this.map.set(key, { value, at: Date.now() });
        while (this.map.size > this.max) {
            const first = this.map.keys().next().value;
            this.map.delete(first);
        }
    }
    delete(key) { this.map.delete(key); }
    clear() { this.map.clear(); }
    has(key) { return this.get(key) !== undefined; }
}

class MessageRetryManager {
    constructor(logger, maxMsgRetryCount = 5) {
        this.logger = logger;
        this.maxMsgRetryCount = maxMsgRetryCount || 5;
        this.recentMessagesMap = new TtlMap(512, 5 * 60 * 1000);
        this.messageKeyIndex = new Map();
        this.sessionRecreateHistory = new TtlMap(256, 2 * 60 * 60 * 1000);
        this.retryCounters = new TtlMap(1024, 15 * 60 * 1000);
        this.pendingPhoneRequests = {};
        this.statistics = { totalRetries: 0, successfulRetries: 0, failedRetries: 0, sessionRecreations: 0 };
    }
    addRecentMessage(to, id, message) {
        const keyStr = `${to}${SEP}${id}`;
        this.recentMessagesMap.set(keyStr, { message, timestamp: Date.now() });
        this.messageKeyIndex.set(id, keyStr);
    }
    getRecentMessage(to, id) {
        return this.recentMessagesMap.get(`${to}${SEP}${id}`);
    }
    getRecentMessageById(id) {
        const keyStr = this.messageKeyIndex.get(id);
        return keyStr ? this.recentMessagesMap.get(keyStr) : undefined;
    }
    shouldRecreateSession(jid, hasSession, errorCode) {
        if (!hasSession || (errorCode !== undefined && MAC_ERROR_CODES.has(errorCode))) {
            this.sessionRecreateHistory.set(jid, Date.now());
            this.statistics.sessionRecreations++;
            return { recreate: true, reason: hasSession ? "mac" : "no-session" };
        }
        const prev = this.sessionRecreateHistory.get(jid);
        if (!prev || Date.now() - prev > 60 * 60 * 1000) {
            this.sessionRecreateHistory.set(jid, Date.now());
            this.statistics.sessionRecreations++;
            return { recreate: true, reason: "stale" };
        }
        return { recreate: false, reason: "" };
    }
    hasExceededMaxRetries(messageId) {
        return (this.retryCounters.get(messageId) || 0) >= this.maxMsgRetryCount;
    }
    clear() {
        this.recentMessagesMap.clear();
        this.messageKeyIndex.clear();
        this.sessionRecreateHistory.clear();
        this.retryCounters.clear();
        for (const id of Object.keys(this.pendingPhoneRequests)) clearTimeout(this.pendingPhoneRequests[id]);
        this.pendingPhoneRequests = {};
    }
}
exports.MessageRetryManager = MessageRetryManager;
