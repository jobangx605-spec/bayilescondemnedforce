"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeBanCheckerSocket = exports.buildVerdict = exports.probeRegistry = exports.probeIdentityDevices = exports.probeSendPage = exports.normalizeJidTarget = void 0;
const WAUSync_1 = require("../WAUSync");

function normalizeJidTarget(input) {
    if (!input) return null;
    let num = String(input).replace(/[^0-9+]/g, "");
    if (!num) return null;
    if (num.startsWith("+")) num = num.slice(1);
    num = num.replace("@s.whatsapp.net", "");
    if (num.length < 8 || num.length > 15) return null;
    return num;
}
exports.normalizeJidTarget = normalizeJidTarget;

const OWN_AVATAR_DOMAIN = "pps.whatsapp.net";

async function probeSendPage(num, fetchImpl) {
    const impl = fetchImpl || globalThis.fetch;
    if (!impl) return { ok: false, generic: null, title: null, hasOwnPic: false };
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const res = await impl(`https://api.whatsapp.com/send?phone=${encodeURIComponent(num)}&type=phone_number&app_absent=0`, {
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
                    "Accept-Language": "en-US,en;q=0.9"
                },
                signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined
            });
            const html = await res.text();
            const raw = ((html.match(/property="og:title" content="([^"]*)"/i) || [])[1] || "");
            const title = raw.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
            const generic = /share on whatsapp/i.test(title);
            const avatar = ((html.match(/property="og:image" content="([^"]*)"/i) || [])[1] || "");
            const hasOwnPic = !generic && new RegExp(OWN_AVATAR_DOMAIN, "i").test(avatar);
            if (!generic) return { ok: true, generic: false, title: title.trim(), hasOwnPic };
            if (attempt === 2) return { ok: true, generic: true, title: null, hasOwnPic: false };
            await new Promise((r) => setTimeout(r, 1500));
        }
        catch (_) {
            if (attempt === 2) return { ok: false, generic: null, title: null, hasOwnPic: false };
            await new Promise((r) => setTimeout(r, 1500));
        }
    }
    return { ok: false, generic: null, title: null, hasOwnPic: false };
}
exports.probeSendPage = probeSendPage;

async function probeIdentityDevices(sock, target) {
    try {
        if (typeof sock.executeUSyncQuery !== "function") return null;
        const q = new WAUSync_1.USyncQuery().withDeviceProtocol().withUser(new WAUSync_1.USyncUser().withId(target + "@s.whatsapp.net"));
        const devRes = await sock.executeUSyncQuery(q);
        if (devRes && Array.isArray(devRes.list) && devRes.list.length > 0) {
            const devInfo = devRes.list[0];
            const dl = (devInfo && devInfo.devices && (devInfo.devices.deviceList || devInfo.devices.device_list)) || null;
            let devices = Array.isArray(dl) ? dl : null;
            if (devices === null && devInfo && devInfo.devices) {
                const d = devInfo.devices;
                for (const k of Object.keys(d)) {
                    if (Array.isArray(d[k])) {
                        devices = d[k];
                        break;
                    }
                }
            }
            return devices === null ? null : devices.length;
        }
        return 0;
    }
    catch (_) {
        return null;
    }
}
exports.probeIdentityDevices = probeIdentityDevices;

async function probeRegistry(sock, target) {
    try {
        if (typeof sock.onWhatsApp !== "function") return null;
        const onWA = await sock.onWhatsApp(target + "@s.whatsapp.net");
        return Array.isArray(onWA) && onWA.length > 0 && onWA[0].exists === true;
    }
    catch (_) {
        return null;
    }
}
exports.probeRegistry = probeRegistry;

function buildVerdict(target, { devices, registry, page }) {
    const profileName = (page && page.title) || null;
    const pageVisible = page && page.ok === true && page.generic === false;
    const pageGeneric = page && page.ok === true && page.generic === true;
    if (devices !== null && devices !== undefined) {
        if (devices >= 2 && page && page.ok) {
            return { status: "ACTIVE", emoji: "🟢", confidence: 0.99, deviceCount: devices, registryExists: registry, pageVisible, profileName, target };
        }
        if (devices === 1 && pageGeneric) {
            return { status: "BANNED", emoji: "🔴", confidence: 0.9, deviceCount: devices, registryExists: registry, pageVisible: false, profileName: null, target };
        }
        if (devices === 1 && pageVisible) {
            return { status: "ACTIVE", emoji: "🟢", confidence: 0.8, deviceCount: devices, registryExists: registry, pageVisible, profileName, target };
        }
        if (devices === 0 && page && page.ok) {
            return {
                status: pageGeneric ? "BANNED" : "OFF_WHATSAPP",
                emoji: "🔴",
                confidence: 0.95,
                deviceCount: devices,
                registryExists: registry,
                pageVisible: false,
                profileName: null,
                target
            };
        }
        if (devices === 0) {
            return { status: "OFF_WHATSAPP", emoji: "🔴", confidence: 0.85, deviceCount: devices, registryExists: registry, pageVisible: false, profileName: null, target };
        }
    }
    if (page && page.ok) {
        if (!pageGeneric && registry === true) {
            return { status: "ACTIVE", emoji: "🟢", confidence: 0.98, deviceCount: null, registryExists: registry, pageVisible, profileName, target };
        }
        if (pageGeneric && registry === true) {
            return { status: "PROFILE_HIDDEN", emoji: "🟡", confidence: 0.6, deviceCount: null, registryExists: registry, pageVisible: false, profileName: null, target };
        }
        if (pageGeneric && registry === false) {
            return { status: "OFF_WHATSAPP", emoji: "🔴", confidence: 0.9, deviceCount: null, registryExists: registry, pageVisible: false, profileName: null, target };
        }
    }
    if (registry === true) {
        return { status: "LIKELY_ACTIVE", emoji: "🟡", confidence: 0.55, deviceCount: null, registryExists: registry, pageVisible: false, profileName: null, target };
    }
    if (registry === false) {
        return { status: "OFF_WHATSAPP", emoji: "🔴", confidence: 0.7, deviceCount: null, registryExists: registry, pageVisible: false, profileName: null, target };
    }
    return { status: "UNKNOWN", emoji: "❓", confidence: 0, deviceCount: null, registryExists: null, pageVisible: null, profileName: null, target };
}
exports.buildVerdict = buildVerdict;

const makeBanCheckerSocket = (sock) => {
    sock.checkBanStatus = async (input) => {
        const target = normalizeJidTarget(input);
        if (!target) throw new Error("checkBanStatus: invalid phone number (need 8-15 digits)");
        const [devices, registry, page] = await Promise.all([
            probeIdentityDevices(sock, target),
            probeRegistry(sock, target),
            probeSendPage(target)
        ]);
        return buildVerdict(target, { devices, registry, page });
    };
    return sock;
};
exports.makeBanCheckerSocket = makeBanCheckerSocket;
