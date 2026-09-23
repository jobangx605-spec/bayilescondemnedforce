"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BrowserPresets = void 0;
const os_1 = require("os");

const PLATFORM_MAP = {
    aix: "AIX",
    darwin: "Mac OS",
    win32: "Windows",
    android: "Android",
    freebsd: "FreeBSD",
    openbsd: "OpenBSD",
    sunos: "Solaris",
    linux: "Linux"
};
const BROWSER_MAP = {
    safari: "Safari",
    chrome: "Chrome",
    edge: "Edge",
    firefox: "Firefox",
    opera: "Opera",
    brave: "Brave"
};
const getBrowserN = (bros) => BROWSER_MAP[String(bros || "").toLowerCase()] || bros;

const BrowserPresets = {
    ubuntu: (browser) => ["Ubuntu", getBrowserN(browser), "22.04.4"],
    macOS: (browser) => ["Mac OS", getBrowserN(browser), "14.4.1"],
    baileys: (browser) => ["Baileys", getBrowserN(browser), "6.5.0"],
    windows: (browser) => ["Windows", getBrowserN(browser), "10.0.22631"],
    iOS: (browser) => ["iOS", getBrowserN(browser), "18.2"],
    android: (browser) => ["Android", getBrowserN(browser), "14.0.0"],
    appropriate: (browser) => [PLATFORM_MAP[os_1.platform()] || "Ubuntu", getBrowserN(browser), os_1.release()]
};
exports.BrowserPresets = BrowserPresets;
