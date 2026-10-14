"use strict";
/**
 * Reliability lane for condemnedforce-baileys.
 * Outbound work is queued (never silently dropped). Replies stay ahead of bulk.
 * IQ queries are capped so a busy bot does not overhit WhatsApp and stall the socket.
 */
const { AsyncLocalStorage } = require("async_hooks");

const queryStore = new AsyncLocalStorage();

const DEFAULTS = {
    enabled: true,
    maxConcurrentQueries: 3,
    minQueryGapMs: 40,
    maxQueryGapMs: 1600,
    maxQueryRetries: 2,
    replyGapMs: 30,
    normalGapMs: 260,
    bulkGapMs: 650,
    burst: 4,
    burstWindowMs: 2000,
    replyWindowMs: 45000,
    maxSendRetries: 2,
    holdWhileOfflineMs: 2500,
    jitterMs: 70,
    failedCap: 40
};

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function statusOf(err) {
    if (!err) return undefined;
    if (err.output && err.output.statusCode) return Number(err.output.statusCode);
    if (typeof err.data === "number") return err.data;
    if (err.statusCode) return Number(err.statusCode);
    return undefined;
}

function isTransient(err) {
    const code = statusOf(err);
    if (code === 401 || code === 403 || code === 440) return false;
    if ([408, 428, 429, 500, 503, 463].includes(code)) return true;
    const msg = String((err && (err.message || err)) || "").toLowerCase();
    return /timed out|timeout|rate-overlimit|overlimit|connection closed|connection was lost|econnreset|socket hang up/.test(msg);
}

function mergeConfig(options) {
    const src = options && typeof options === "object" ? options : {};
    return { ...DEFAULTS, ...src, enabled: src.enabled !== false && options !== false };
}

function normalizeJid(jid) {
    if (!jid) return "";
    return String(jid).split(":")[0];
}

function priorityOf(content, options, jid, recentInbound, replyWindowMs) {
    const explicit = options && options.priority;
    if (explicit === "high" || explicit === 0) return 0;
    if (explicit === "low" || explicit === 2 || (options && options.bulk)) return 2;
    if (explicit === "normal" || explicit === 1) return 1;
    if (options && options.quoted) return 0;
    if (content && (content.quoted || content.react || content.delete || content.edit)) return 0;
    const seen = recentInbound.get(normalizeJid(jid));
    if (seen && Date.now() - seen < replyWindowMs) return 0;
    if (jid === "status@broadcast") return 2;
    return 1;
}

function suggestReconnect(error) {
    const code = statusOf(error);
    if (code === 401 || code === 440 || code === 411) {
        return { shouldReconnect: false, delayMs: 0, reason: "terminal" };
    }
    if (code === 403) {
        return { shouldReconnect: true, delayMs: 60000, reason: "forbidden" };
    }
    if (code === 429 || code === 463) {
        return {
            shouldReconnect: true,
            delayMs: 20000 + Math.floor(Math.random() * 10000),
            reason: "rate"
        };
    }
    if (code === 515) {
        return { shouldReconnect: true, delayMs: 800, reason: "restart" };
    }
    if (code === 503) {
        return { shouldReconnect: true, delayMs: 5000, reason: "unavailable" };
    }
    return {
        shouldReconnect: true,
        delayMs: 1500 + Math.floor(Math.random() * 1500),
        reason: "retry"
    };
}

function createSendLane(options = {}) {
    const cfg = mergeConfig(options);
    const logger = options.logger;
    const isOpen = typeof options.isOpen === "function" ? options.isOpen : () => true;
    const queue = [];
    const recentInbound = new Map();
    const failed = [];
    let seq = 0;
    let pumping = false;
    let wake = null;
    let nextReplyAt = 0;
    let nextNormalAt = 0;
    let nextBulkAt = 0;
    const nextJidAt = new Map();
    let pauseUntil = 0;
    let burstCount = 0;
    let burstWindowStart = 0;
    const stats = { queued: 0, sent: 0, retried: 0, failed: 0, dropped: 0 };

    function gapFor(job) {
        if (job.priority === 0) {
            const inBurst = burstCount < cfg.burst && (Date.now() - burstWindowStart) < cfg.burstWindowMs;
            const gap = inBurst ? 0 : cfg.replyGapMs;
            return { global: gap, jid: inBurst ? 0 : Math.min(80, cfg.replyGapMs) };
        }
        if (job.priority >= 2) return { global: cfg.bulkGapMs, jid: cfg.bulkGapMs };
        return { global: cfg.normalGapMs, jid: cfg.normalGapMs };
    }

    function waitFor(job) {
        const now = Date.now();
        const jidAt = nextJidAt.get(normalizeJid(job.jid)) || 0;
        // Replies never wait behind bulk/normal pacing. Slower classes wait for themselves.
        let globalAt = nextReplyAt;
        if (job.priority >= 1) globalAt = Math.max(globalAt, nextNormalAt);
        if (job.priority >= 2) globalAt = Math.max(globalAt, nextBulkAt);
        return Math.max(0, pauseUntil - now, globalAt - now, jidAt - now);
    }

    function markSent(job) {
        const gap = gapFor(job);
        const jitter = cfg.jitterMs ? Math.floor(Math.random() * cfg.jitterMs) : 0;
        const now = Date.now();
        const at = now + gap.global + (job.priority === 0 ? 0 : jitter);
        if (job.priority === 0) nextReplyAt = at;
        else if (job.priority === 1) nextNormalAt = at;
        else nextBulkAt = at;
        nextJidAt.set(normalizeJid(job.jid), now + gap.jid + jitter);
        if (job.priority === 0) {
            if (Date.now() - burstWindowStart > cfg.burstWindowMs) {
                burstWindowStart = Date.now();
                burstCount = 0;
            }
            burstCount += 1;
        }
    }

    function rememberFailure(job, err) {
        stats.failed += 1;
        const content = job.content;
        failed.push({
            jid: job.jid,
            content,
            options: job.options,
            error: String((err && err.message) || err),
            at: Date.now()
        });
        while (failed.length > cfg.failedCap) failed.shift();
        if (logger && logger.warn) {
            logger.warn({ jid: job.jid, err: String((err && err.message) || err) }, "send failed after lane retries");
        }
    }

    async function pump() {
        while (queue.length) {
            queue.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
            const job = queue[0];
            const wait = waitFor(job);
            if (wait > 0) {
                await new Promise((resolve) => {
                    const timer = setTimeout(resolve, wait);
                    wake = () => {
                        clearTimeout(timer);
                        resolve();
                    };
                });
                wake = null;
                continue;
            }
            if (!isOpen()) {
                const age = Date.now() - job.enqueuedAt;
                if (age < cfg.holdWhileOfflineMs) {
                    await sleep(Math.min(400, cfg.holdWhileOfflineMs - age));
                    continue;
                }
                queue.shift();
                const err = new Error("Connection closed before send could be delivered");
                err.statusCode = 428;
                rememberFailure(job, err);
                job.reject(err);
                continue;
            }
            queue.shift();
            try {
                const result = await job.run();
                stats.sent += 1;
                markSent(job);
                job.resolve(result);
            }
            catch (err) {
                const closed = !isOpen();
                if (closed && job.attempts < cfg.maxSendRetries && Date.now() - job.enqueuedAt < cfg.holdWhileOfflineMs) {
                    job.attempts += 1;
                    stats.retried += 1;
                    queue.unshift(job);
                    pauseUntil = Date.now() + 200;
                    continue;
                }
                rememberFailure(job, err);
                job.reject(err);
            }
        }
    }

    function kick() {
        if (pumping) return;
        pumping = true;
        pump()
            .catch((err) => {
                if (logger && logger.error) logger.error({ err }, "send lane crashed");
            })
            .finally(() => {
                pumping = false;
                if (queue.length) kick();
            });
    }

    function enqueue({ jid, content, options, run, priority }) {
        if (!cfg.enabled) return Promise.resolve().then(run);
        const opts = options || {};
        const jobPriority = typeof priority === "number"
            ? priority
            : priorityOf(content, { ...opts, priority: opts.priority || (priority === "low" ? "low" : opts.priority) }, jid, recentInbound, cfg.replyWindowMs);
        return new Promise((resolve, reject) => {
            const job = {
                jid,
                content,
                options: opts,
                run,
                resolve,
                reject,
                priority: typeof priority === "number" ? priority : priorityOf(content, opts, jid, recentInbound, cfg.replyWindowMs),
                seq: seq++,
                attempts: 0,
                enqueuedAt: Date.now()
            };
            if (typeof priority === "number") job.priority = priority;
            else if (priority === "low") job.priority = 2;
            else if (priority === "high") job.priority = 0;
            else job.priority = jobPriority;
            queue.push(job);
            stats.queued += 1;
            if (wake) wake();
            kick();
        });
    }

    return {
        enqueue,
        noteInbound(jid) {
            if (!jid) return;
            recentInbound.set(normalizeJid(jid), Date.now());
            if (recentInbound.size > 2000) {
                const cutoff = Date.now() - cfg.replyWindowMs;
                for (const [key, at] of recentInbound) {
                    if (at < cutoff) recentInbound.delete(key);
                }
            }
        },
        stats() {
            return {
                ...stats,
                pending: queue.length,
                failedWaiting: failed.length,
                enabled: cfg.enabled,
                pauseUntil
            };
        },
        drainFailed() {
            return failed.splice(0, failed.length);
        },
        config: cfg
    };
}

function coalesceKey(node) {
    if (!node || !node.attrs || node.attrs.type === "set") return null;
    const xmlns = node.attrs.xmlns;
    if (xmlns !== "w:g2" && xmlns !== "privacy" && xmlns !== "w:profile:picture") return null;
    return [node.tag, xmlns, node.attrs.type, node.attrs.to || "", node.attrs.target || ""].join("|");
}

function createQueryLane(options = {}) {
    const cfg = mergeConfig(options);
    const logger = options.logger;
    let active = 0;
    let gapMs = cfg.minQueryGapMs;
    let nextSlotAt = 0;
    const waiters = [];
    const inflight = new Map();
    const stats = { ran: 0, coalesced: 0, retried: 0, failed: 0 };

    function release() {
        active = Math.max(0, active - 1);
        const next = waiters.shift();
        if (next) next();
    }

    async function acquire(fast) {
        while (active >= cfg.maxConcurrentQueries) {
            await new Promise((resolve) => waiters.push(resolve));
        }
        const gap = fast ? 0 : gapMs;
        const wait = nextSlotAt - Date.now();
        if (!fast && wait > 0) await sleep(wait);
        active += 1;
        nextSlotAt = Date.now() + gap;
    }

    async function runOnce(node, fn) {
        const fast = node && node.attrs && (node.attrs.xmlns === "encrypt" || node.attrs.xmlns === "usync");
        await acquire(!!fast);
        try {
            const result = await fn();
            gapMs = Math.max(cfg.minQueryGapMs, Math.floor(gapMs * 0.85));
            stats.ran += 1;
            return result;
        }
        catch (err) {
            const retryable = isTransient(err) && node && node.attrs && node.attrs.type !== "set";
            if (!retryable) {
                stats.failed += 1;
                throw err;
            }
            throw Object.assign(err, { __laneRetry: true });
        }
        finally {
            release();
        }
    }

    async function run(node, fn) {
        if (!cfg.enabled) return fn();
        if (queryStore.getStore()) return fn();
        const key = coalesceKey(node);
        if (key && inflight.has(key)) {
            stats.coalesced += 1;
            return inflight.get(key);
        }
        const task = queryStore.run(true, async () => {
            let attempt = 0;
            while (true) {
                try {
                    return await runOnce(node, fn);
                }
                catch (err) {
                    if (err && err.__laneRetry && attempt < cfg.maxQueryRetries) {
                        attempt += 1;
                        stats.retried += 1;
                        gapMs = Math.min(cfg.maxQueryGapMs, Math.floor(gapMs * 1.8) + 40);
                        if (logger && logger.debug) {
                            logger.debug({ attempt, gapMs, xmlns: node && node.attrs && node.attrs.xmlns }, "retrying query after transient error");
                        }
                        await sleep(gapMs);
                        continue;
                    }
                    if (err && err.__laneRetry) stats.failed += 1;
                    throw err;
                }
            }
        });
        if (key) {
            inflight.set(key, task);
            const clear = () => {
                if (inflight.get(key) === task) inflight.delete(key);
            };
            task.then(clear, clear);
        }
        return task;
    }

    return {
        run,
        stats() {
            return { ...stats, active, gapMs, enabled: cfg.enabled };
        }
    };
}

function createOfflineQueue({ isOpen, onError, handlers }) {
    const nodes = [];
    let isProcessing = false;

    const drain = () => {
        if (isProcessing) return;
        isProcessing = true;
        const run = async () => {
            try {
                while (nodes.length && isOpen()) {
                    const item = nodes.shift();
                    const handler = handlers.get(item.type);
                    if (!handler) {
                        onError(new Error(`unknown offline node type: ${item.type}`), "processing offline node");
                        continue;
                    }
                    try {
                        await handler(item.node);
                    }
                    catch (error) {
                        onError(error, "processing offline node");
                    }
                }
            }
            finally {
                isProcessing = false;
                if (nodes.length && isOpen()) drain();
            }
        };
        run().catch((error) => {
            isProcessing = false;
            onError(error, "processing offline nodes");
            if (nodes.length && isOpen()) drain();
        });
    };

    return {
        enqueue(type, node) {
            nodes.push({ type, node });
            drain();
        },
        size() {
            return nodes.length;
        }
    };
}

module.exports = {
    DEFAULTS,
    isTransient,
    suggestReconnect,
    createSendLane,
    createQueryLane,
    createOfflineQueue
};
