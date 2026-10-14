"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.USyncUsernameProtocol = void 0;
const WABinary_1 = require("../../WABinary");

class USyncUsernameProtocol {
    constructor() {
        this.name = "username";
    }
    getQueryElement() {
        return { tag: "username", attrs: {} };
    }
    getUserElement() {
        return null;
    }
    parser(node) {
        if (node.tag === "username") {
            WABinary_1.assertNodeErrorFree(node);
            if (typeof node.content === "string") return node.content;
            if (Buffer.isBuffer(node.content)) return node.content.toString();
            return node.attrs && (node.attrs.username || node.attrs.name) || null;
        }
        return null;
    }
}
exports.USyncUsernameProtocol = USyncUsernameProtocol;
