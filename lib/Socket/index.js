"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Defaults_1 = require("../Defaults");
const communities_1 = require("./communities");
const ban_checker_1 = require("./ban-checker");
// export the last socket layer
const makeWASocket = (config) => ban_checker_1.makeBanCheckerSocket(communities_1.makeCommunitiesSocket({
    ...Defaults_1.DEFAULT_CONNECTION_CONFIG,
    ...config
}));
exports.default = makeWASocket;
exports.makeWASocket = makeWASocket;
