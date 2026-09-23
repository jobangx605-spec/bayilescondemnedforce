"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleIdentityChange = void 0;
const WABinary_1 = require("../WABinary");

async function handleIdentityChange(node, ctx) {
    const from = node.attrs.from;
    if (!from) return { action: "invalid_notification" };
    const identityNode = WABinary_1.getBinaryNodeChild(node, "identity");
    if (!identityNode) return { action: "no_identity_node" };
    ctx.logger.info({ jid: from }, "identity changed");
    const decoded = WABinary_1.jidDecode(from);
    if (decoded && decoded.device && decoded.device !== 0) {
        return { action: "skipped_companion_device", device: decoded.device };
    }
    const isSelfPrimary = ctx.meId && (WABinary_1.areJidsSameUser(from, ctx.meId) || (ctx.meLid && WABinary_1.areJidsSameUser(from, ctx.meLid)));
    if (isSelfPrimary) return { action: "skipped_self_primary" };
    if (ctx.debounceCache && ctx.debounceCache.get(from)) return { action: "debounced" };
    if (ctx.debounceCache) ctx.debounceCache.set(from, true);
    const isOffline = !!(node.attrs.offline);
    const hasExistingSession = await ctx.validateSession(from);
    if (!hasExistingSession || !hasExistingSession.exists) return { action: "skipped_no_session" };
    if (isOffline) return { action: "skipped_offline" };
    if (ctx.onBeforeSessionRefresh) ctx.onBeforeSessionRefresh(from);
    try {
        await ctx.assertSessions([from], true);
        return { action: "session_refreshed" };
    }
    catch (error) {
        ctx.logger.warn({ error, jid: from }, "failed to assert sessions after identity change");
        return { action: "session_refresh_failed", error };
    }
}
exports.handleIdentityChange = handleIdentityChange;
