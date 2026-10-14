"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RateLimiter = void 0;

const TIME_CONSTANTS = {
    MS_PER_SECOND: 1000,
    MS_PER_MINUTE: 60000,
    MS_PER_HOUR: 3600000,
    MS_PER_DAY: 86400000,
    BURST_RESET_MS: 30000,
    IDENTICAL_WINDOW_MS: 3600000
};

const DEFAULT_CONFIG = {
    maxPerMinute: 8,
    maxPerHour: 200,
    maxPerDay: 1500,
    minDelayMs: 1500,
    maxDelayMs: 5000,
    newChatDelayMs: 3000,
    maxIdenticalMessages: 3,
    burstAllowance: 3,
    identicalMessageWindowMs: TIME_CONSTANTS.IDENTICAL_WINDOW_MS
};

class RateLimiter {
    constructor(config = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.messages = [];
        this.identicalCount = new Map();
        this.knownChats = new Set();
        this.burstCount = 0;
        this.lastMessageTime = 0;
    }
    async getDelay(recipient, content) {
        const now = Date.now();
        this.cleanup(now);
        const contentHash = this.hashContent(String(content || ""));
        const dayMessages = this.messages.filter((m) => now - m.timestamp < TIME_CONSTANTS.MS_PER_DAY);
        if (dayMessages.length >= this.config.maxPerDay) return -1;
        const hourMessages = this.messages.filter((m) => now - m.timestamp < TIME_CONSTANTS.MS_PER_HOUR);
        if (hourMessages.length >= this.config.maxPerHour) {
            hourMessages.sort((a, b) => a.timestamp - b.timestamp);
            const oldest = hourMessages[0];
            return Math.max(oldest ? oldest.timestamp + TIME_CONSTANTS.MS_PER_HOUR - now : TIME_CONSTANTS.MS_PER_HOUR, TIME_CONSTANTS.MS_PER_MINUTE);
        }
        const minuteMessages = this.messages.filter((m) => now - m.timestamp < TIME_CONSTANTS.MS_PER_MINUTE);
        if (minuteMessages.length >= this.config.maxPerMinute) {
            minuteMessages.sort((a, b) => a.timestamp - b.timestamp);
            const oldest = minuteMessages[0];
            return Math.max(oldest ? oldest.timestamp + TIME_CONSTANTS.MS_PER_MINUTE - now : TIME_CONSTANTS.MS_PER_MINUTE, TIME_CONSTANTS.MS_PER_SECOND);
        }
        const tracker = this.identicalCount.get(contentHash);
        if (tracker && now - tracker.firstSeen < this.config.identicalMessageWindowMs && tracker.count >= this.config.maxIdenticalMessages) {
            return -1;
        }
        let delay = this.burstCount < this.config.burstAllowance
            ? this.jitter(this.config.minDelayMs * 0.5, this.config.minDelayMs)
            : this.jitter(this.config.minDelayMs, this.config.maxDelayMs);
        if (this.burstCount < this.config.burstAllowance) this.burstCount++;
        if (!this.knownChats.has(recipient)) delay += this.jitter(this.config.newChatDelayMs * 0.5, this.config.newChatDelayMs);
        const timeSinceLast = now - this.lastMessageTime;
        if (timeSinceLast < this.config.minDelayMs) delay = Math.max(delay, this.config.minDelayMs - timeSinceLast);
        delay += this.jitter(Math.min(String(content || "").length * 30, 3000) * 0.5, Math.min(String(content || "").length * 30, 3000));
        return Math.round(delay);
    }
    record(recipient, content) {
        const now = Date.now();
        if (this.messages.length > 0 && now - this.messages[0].timestamp > TIME_CONSTANTS.MS_PER_DAY) this.cleanup(now);
        const contentHash = this.hashContent(String(content || ""));
        if (now - this.lastMessageTime > TIME_CONSTANTS.BURST_RESET_MS) this.burstCount = 0;
        this.messages.push({ timestamp: now, recipient, contentHash });
        this.knownChats.add(recipient);
        this.lastMessageTime = now;
        const tracker = this.identicalCount.get(contentHash);
        if (tracker && now - tracker.firstSeen < this.config.identicalMessageWindowMs) {
            tracker.count++;
            tracker.lastSeen = now;
        }
        else {
            this.identicalCount.set(contentHash, { count: 1, firstSeen: now, lastSeen: now });
        }
    }
    async reserve(recipient, content) {
        const delay = await this.getDelay(recipient, content);
        if (delay === -1) return -1;
        this.record(recipient, content);
        return delay;
    }
    getStats() {
        const now = Date.now();
        this.cleanup(now);
        return {
            lastMinute: this.messages.filter((m) => now - m.timestamp < TIME_CONSTANTS.MS_PER_MINUTE).length,
            lastHour: this.messages.filter((m) => now - m.timestamp < TIME_CONSTANTS.MS_PER_HOUR).length,
            lastDay: this.messages.filter((m) => now - m.timestamp < TIME_CONSTANTS.MS_PER_DAY).length,
            limits: { perMinute: this.config.maxPerMinute, perHour: this.config.maxPerHour, perDay: this.config.maxPerDay },
            knownChats: this.knownChats.size
        };
    }
    restoreKnownChats(chats) {
        for (const jid of chats || []) this.knownChats.add(jid);
    }
    cleanup(now) {
        this.messages = this.messages.filter((m) => now - m.timestamp < TIME_CONSTANTS.MS_PER_DAY);
        for (const [hash, tracker] of this.identicalCount.entries()) {
            if (now - tracker.lastSeen > this.config.identicalMessageWindowMs) this.identicalCount.delete(hash);
        }
    }
    jitter(min, max) {
        const u1 = Math.random() || 0.0001;
        const u2 = Math.random();
        const normal = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        const clamped = Math.max(0, Math.min(1, (normal + 3) / 6));
        return Math.round(min + clamped * (max - min));
    }
    hashContent(content) {
        let hash = 0;
        for (let i = 0; i < content.length; i++) {
            hash = ((hash << 5) - hash + content.charCodeAt(i)) | 0;
        }
        return hash.toString(36);
    }
}
exports.RateLimiter = RateLimiter;
