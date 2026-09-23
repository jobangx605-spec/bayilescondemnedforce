"use strict";

const clearConsole = () => {
  process.stdout.write(
    process.platform === "win32" ? "\x1B[2J\x1B[0f" : "\x1B[2J\x1B[3J\x1B[H"
  );
};

clearConsole();

const C = {
  reset: "\x1b[0m",
  hide: "\x1b[?25l",
  show: "\x1b[?25h",
  gold: "\x1b[38;5;220m",
  amber: "\x1b[38;5;214m",
  orange: "\x1b[38;5;208m",
  red: "\x1b[38;5;196m",
  fire: "\x1b[38;5;202m",
  ember: "\x1b[38;5;160m",
  scale: "\x1b[38;5;172m",
  dark: "\x1b[38;5;94m",
  eye: "\x1b[38;5;226m",
  smoke: "\x1b[38;5;240m",
  title: "\x1b[38;5;196m",
  line: "\x1b[38;5;208m",
  dim: "\x1b[38;5;245m"
};

const dragon = [
  "                         ___====-_  _-====___",
  "                   _--^^^#####//      \\\\#####^^^--_",
  "                _-^##########// (    ) \\\\##########^-_",
  "               -############//  |\\^^/|  \\\\############-",
  "             _/############//   (@::@)   \\\\############\\_",
  "            /#############((     \\\\//     ))#############\\",
  "           -###############\\\\    (oo)    //###############-",
  "          -#################\\\\  / VV \\  //#################-",
  "         -###################\\\\/      \\//###################-",
  "        _#/|##########/\\######(   /\\   )######/\\##########|\\#_",
  "        |/ |#/\\#/\\#/\\/  \\#/\\##\\  |  |  /##/\\#/  \\/\\#/\\#/\\#| \\|",
  "        `  |/  V  V  `   V  \\#\\| |  | |/#/  V   '  V  V  \\|  '",
  "           `   `  `      `   / | |  | | \\   '      '  '   '",
  "                            (  | |  | |  )",
  "                           __\\ | |  | | /__",
  "                          (vvv(VVV)(VVV)vvv)"
].map((line, i) => {
  const tone = [C.fire, C.orange, C.amber, C.gold, C.scale, C.gold, C.amber, C.red, C.fire, C.gold, C.scale, C.dark, C.amber, C.gold, C.red, C.fire][i] || C.gold;
  return tone + line
    .replace(/@::@|oo|VV/g, C.eye + "$&" + tone)
    .replace(/vvv|VVV|FIRE/g, C.red + "$&" + tone) + C.reset;
});

process.stdout.write(C.hide + dragon.join("\n") + "\n" + `
${C.line}          ╭──────────────────────────────────────╮${C.reset}
${C.red}          │     D R A G O N   F O R C E          │${C.reset}
${C.gold}          │     C O N D E M N E D   F O R C E    │${C.reset}
${C.line}          ╰──────────────────────────────────────╯${C.reset}
${C.dim}          v2.3.0  ·  JID nomor  ·  ID 3EB0  ·  anti-call ON${C.reset}
` + C.show);

var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeWASocket = void 0;
const Socket_1 = __importDefault(require("./Socket"));
exports.makeWASocket = Socket_1.default;
__exportStar(require("../WAProto"), exports);
__exportStar(require("./Utils"), exports);
__exportStar(require("./Types"), exports);
__exportStar(require("./Store"), exports);
__exportStar(require("./Defaults"), exports);
__exportStar(require("./WABinary"), exports);
__exportStar(require("./WAM"), exports);
__exportStar(require("./WAUSync"), exports);

exports.default = Socket_1.default;
