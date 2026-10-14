"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyDisconnect = void 0;

function classifyDisconnect(statusCode) {
    const code = typeof statusCode === "string" ? Number(statusCode) : statusCode;
    if (code === 401 || code === 440) {
        return { category: "fatal", shouldReconnect: false, message: "Logged out — restart with QR code required", code };
    }
    if (code === 515) {
        return { category: "recoverable", shouldReconnect: true, backoffMs: 0, message: "Restart required by WhatsApp — reconnect immediately", code };
    }
    if (code === 405) {
        return { category: "fatal", shouldReconnect: false, message: "Method not allowed — server rejected connection method", code };
    }
    if (code === 409) {
        return { category: "fatal", shouldReconnect: false, message: "Connection replaced — another device took over", code };
    }
    if (code === 428) {
        return { category: "recoverable", shouldReconnect: true, backoffMs: 2000, message: "Connection closed — safe to reconnect", code };
    }
    if (code === 412) {
        return { category: "recoverable", shouldReconnect: true, backoffMs: 30000, message: "Precondition failed — auth state mismatch, retry after delay", code };
    }
    if (code === 429) {
        return { category: "rate-limited", shouldReconnect: true, backoffMs: 300000, message: "Rate limited by WhatsApp — cool-off period required", code };
    }
    if (code === 503) {
        return { category: "rate-limited", shouldReconnect: true, backoffMs: 60000, message: "WhatsApp service unavailable — temporary outage", code };
    }
    if (code === 408) {
        return { category: "recoverable", shouldReconnect: true, backoffMs: 5000, message: "Connection timeout — network issue, safe to retry", code };
    }
    if (code === 500) {
        return { category: "recoverable", shouldReconnect: true, backoffMs: 10000, message: "WhatsApp internal error — temporary server issue", code };
    }
    if (code === 1000) {
        return { category: "recoverable", shouldReconnect: true, backoffMs: 2000, message: "Connection closed gracefully — safe to reconnect", code };
    }
    return { category: "unknown", shouldReconnect: true, backoffMs: 15000, message: `Unknown disconnect reason (code ${code}) — reconnect with caution`, code };
}
exports.classifyDisconnect = classifyDisconnect;
