"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateRichMessageContent = exports.generateUnifiedResponseContent = exports.captureUnifiedResponse = exports.generateLatexInlineImageContent = exports.generateLatexImageContent = exports.generateLatexContent = exports.generateCodeBlockContent = exports.generateListContent = exports.generateTableContent = exports.buildBotForwardedMessage = exports.buildRichContextInfo = exports.tokenizeCode = exports.RichSubMessageType = exports.CodeHighlightType = void 0;
const generics_1 = require("./generics");

const JS_KEYWORDS = new Set([
    "import", "export", "from", "default", "as", "const", "let", "var",
    "function", "class", "extends", "new", "return", "if", "else", "for",
    "while", "do", "switch", "case", "break", "continue", "try", "catch",
    "finally", "throw", "async", "await", "yield", "typeof", "instanceof",
    "in", "of", "delete", "void", "true", "false", "null", "undefined",
    "NaN", "Infinity", "this", "super", "static", "get", "set", "debugger", "with"
]);
const PYTHON_KEYWORDS = new Set([
    "import", "from", "as", "def", "class", "return", "if", "elif", "else",
    "for", "while", "break", "continue", "try", "except", "finally", "raise",
    "with", "yield", "lambda", "pass", "del", "global", "nonlocal", "assert",
    "True", "False", "None", "and", "or", "not", "in", "is", "async", "await",
    "self", "print"
]);
const LANGUAGE_KEYWORDS = {
    javascript: JS_KEYWORDS,
    typescript: JS_KEYWORDS,
    js: JS_KEYWORDS,
    ts: JS_KEYWORDS,
    python: PYTHON_KEYWORDS,
    py: PYTHON_KEYWORDS
};

const CodeHighlightType = { DEFAULT: 0, KEYWORD: 1, METHOD: 2, STRING: 3, NUMBER: 4, COMMENT: 5 };
exports.CodeHighlightType = CodeHighlightType;
const RichSubMessageType = { UNKNOWN: 0, GRID_IMAGE: 1, TEXT: 2, INLINE_IMAGE: 3, TABLE: 4, CODE: 5, DYNAMIC: 6, MAP: 7, LATEX: 8, CONTENT_ITEMS: 9 };
exports.RichSubMessageType = RichSubMessageType;

const tokenizeCode = (codeStr, language = "javascript") => {
    const keywords = LANGUAGE_KEYWORDS[language] || JS_KEYWORDS;
    const blocks = [];
    const lines = String(codeStr || "").split("\n");
    for (let li = 0; li < lines.length; li++) {
        const line = lines[li];
        const nl = li === lines.length - 1 ? "" : "\n";
        if (!line.trim()) {
            blocks.push({ highlightType: CodeHighlightType.DEFAULT, codeContent: line + nl });
            continue;
        }
        if (line.trim().startsWith("//") || line.trim().startsWith("#")) {
            blocks.push({ highlightType: CodeHighlightType.COMMENT, codeContent: line + nl });
            continue;
        }
        const regex = /(\/\/.*$|#.*$)|(["'`](?:[^"'`\\]|\\.)*["'`])|(\b\d+(?:\.\d+)?\b)|(\b[a-zA-Z_$][\w$]*\b)|([^\s\w$"'`]+)|(\s+)/g;
        let match;
        const tokens = [];
        while ((match = regex.exec(line)) !== null) {
            const val = match[0];
            if (match[1]) tokens.push({ highlightType: CodeHighlightType.COMMENT, codeContent: val });
            else if (match[2]) tokens.push({ highlightType: CodeHighlightType.STRING, codeContent: val });
            else if (match[3]) tokens.push({ highlightType: CodeHighlightType.NUMBER, codeContent: val });
            else if (match[4]) {
                if (keywords.has(val)) tokens.push({ highlightType: CodeHighlightType.KEYWORD, codeContent: val });
                else if (line.slice(regex.lastIndex).trimStart().startsWith("(")) tokens.push({ highlightType: CodeHighlightType.METHOD, codeContent: val });
                else tokens.push({ highlightType: CodeHighlightType.DEFAULT, codeContent: val });
            }
            else tokens.push({ highlightType: CodeHighlightType.DEFAULT, codeContent: val });
        }
        if (!tokens.length) {
            blocks.push({ highlightType: CodeHighlightType.DEFAULT, codeContent: line + nl });
            continue;
        }
        const merged = [];
        for (const t of tokens) {
            const prev = merged[merged.length - 1];
            if (prev && prev.highlightType === t.highlightType) prev.codeContent += t.codeContent;
            else merged.push({ ...t });
        }
        merged[merged.length - 1].codeContent += nl;
        blocks.push(...merged);
    }
    return blocks;
};
exports.tokenizeCode = tokenizeCode;

const buildRichContextInfo = (quoted, options) => {
    const ctxInfo = {
        forwardingScore: 1,
        isForwarded: true,
        forwardedAiBotMessageInfo: { botJid: (options && options.botJid) || "867051314767696@bot" },
        forwardOrigin: 4,
        ...(options && options.mentions ? { mentionedJid: options.mentions } : {})
    };
    if (quoted && quoted.key) {
        ctxInfo.stanzaId = quoted.key.id;
        ctxInfo.participant = quoted.key.participant || quoted.sender || quoted.key.remoteJid;
        ctxInfo.quotedMessage = quoted.message;
    }
    return ctxInfo;
};
exports.buildRichContextInfo = buildRichContextInfo;

const buildBotForwardedMessage = (submessages, contextInfo, unifiedResponse) => {
    const richResponse = { messageType: 1, submessages, contextInfo };
    if (unifiedResponse) richResponse.unifiedResponse = unifiedResponse;
    return { botForwardedMessage: { message: { richResponseMessage: richResponse } } };
};
exports.buildBotForwardedMessage = buildBotForwardedMessage;

const generateTableContent = (title, headers, rows, quoted, options = {}) => {
    const tableRows = [{ items: headers, isHeading: true }, ...(rows || []).map((row) => ({ items: row.map(String) }))];
    const submessages = [];
    if (options.headerText) submessages.push({ messageType: RichSubMessageType.TEXT, messageText: options.headerText });
    submessages.push({ messageType: RichSubMessageType.TABLE, tableMetadata: { title, rows: tableRows } });
    if (options.footer) submessages.push({ messageType: RichSubMessageType.TEXT, messageText: options.footer });
    return { message: buildBotForwardedMessage(submessages, buildRichContextInfo(quoted, options)), messageId: generics_1.generateMessageIDV2() };
};
exports.generateTableContent = generateTableContent;

const generateListContent = (title, items, quoted, options = {}) => {
    const tableRows = (items || []).map((item) => ({ items: Array.isArray(item) ? item.map(String) : [String(item)] }));
    const submessages = [];
    if (options.headerText) submessages.push({ messageType: RichSubMessageType.TEXT, messageText: options.headerText });
    submessages.push({ messageType: RichSubMessageType.TABLE, tableMetadata: { title, rows: tableRows } });
    if (options.footer) submessages.push({ messageType: RichSubMessageType.TEXT, messageText: options.footer });
    return { message: buildBotForwardedMessage(submessages, buildRichContextInfo(quoted, options)), messageId: generics_1.generateMessageIDV2() };
};
exports.generateListContent = generateListContent;

const generateCodeBlockContent = (code, quoted, options = {}) => {
    const language = options.language || "javascript";
    const submessages = [];
    if (options.title) submessages.push({ messageType: RichSubMessageType.TEXT, messageText: options.title });
    submessages.push({ messageType: RichSubMessageType.CODE, codeMetadata: { codeLanguage: language, codeBlocks: tokenizeCode(code, language) } });
    if (options.footer) submessages.push({ messageType: RichSubMessageType.TEXT, messageText: options.footer });
    return { message: buildBotForwardedMessage(submessages, buildRichContextInfo(quoted, options)), messageId: generics_1.generateMessageIDV2() };
};
exports.generateCodeBlockContent = generateCodeBlockContent;

const generateLatexContent = (quoted, options = {}) => {
    const submessages = [];
    if (options.headerText) submessages.push({ messageType: RichSubMessageType.TEXT, messageText: options.headerText });
    submessages.push({
        messageType: RichSubMessageType.LATEX,
        latexMetadata: {
            text: options.text || "",
            expressions: (options.expressions || []).map((expr) => ({
                latexExpression: expr.latexExpression,
                url: expr.url,
                width: expr.width,
                height: expr.height,
                fontHeight: expr.fontHeight,
                imageTopPadding: expr.imageTopPadding,
                imageLeadingPadding: expr.imageLeadingPadding,
                imageBottomPadding: expr.imageBottomPadding,
                imageTrailingPadding: expr.imageTrailingPadding
            }))
        }
    });
    if (options.footer) submessages.push({ messageType: RichSubMessageType.TEXT, messageText: options.footer });
    return { message: buildBotForwardedMessage(submessages, buildRichContextInfo(quoted, options)), messageId: generics_1.generateMessageIDV2() };
};
exports.generateLatexContent = generateLatexContent;

const generateLatexImageContent = async (quoted, options, uploadFn, renderLatexToPng) => {
    const expressions = await Promise.all((options.expressions || []).map(async (expr) => {
        const rendered = await renderLatexToPng(expr.latexExpression);
        const uploadResult = await uploadFn(rendered.buffer, "image");
        return {
            latexExpression: expr.latexExpression,
            url: uploadResult.url || uploadResult.directPath,
            width: rendered.width,
            height: rendered.height
        };
    }));
    return generateLatexContent(quoted, { ...options, expressions });
};
exports.generateLatexImageContent = generateLatexImageContent;

const generateLatexInlineImageContent = async (quoted, options, uploadFn, renderLatexToPng) => {
    const submessages = [];
    if (options.headerText) submessages.push({ messageType: RichSubMessageType.TEXT, messageText: options.headerText });
    if (options.text) submessages.push({ messageType: RichSubMessageType.TEXT, messageText: options.text });
    for (const expr of options.expressions || []) {
        const rendered = await renderLatexToPng(expr.latexExpression);
        const uploadResult = await uploadFn(rendered.buffer, "image");
        const imageUrl = uploadResult.url || uploadResult.directPath;
        submessages.push({
            messageType: RichSubMessageType.INLINE_IMAGE,
            imageMetadata: {
                imageUrl: { imagePreviewUrl: imageUrl, imageHighResUrl: imageUrl },
                imageText: expr.latexExpression,
                alignment: 2
            }
        });
    }
    if (options.footer) submessages.push({ messageType: RichSubMessageType.TEXT, messageText: options.footer });
    return { message: buildBotForwardedMessage(submessages, buildRichContextInfo(quoted, options)), messageId: generics_1.generateMessageIDV2() };
};
exports.generateLatexInlineImageContent = generateLatexInlineImageContent;

const captureUnifiedResponse = (msg) => {
    const botFwd = msg && msg.botForwardedMessage && msg.botForwardedMessage.message;
    if (!botFwd) return null;
    const rich = botFwd.richResponseMessage;
    if (!rich || !rich.unifiedResponse || !rich.unifiedResponse.data) return null;
    return { unifiedResponse: { data: rich.unifiedResponse.data }, submessages: rich.submessages || [], contextInfo: rich.contextInfo || {} };
};
exports.captureUnifiedResponse = captureUnifiedResponse;

const generateUnifiedResponseContent = (quoted, captured) => ({
    message: buildBotForwardedMessage(captured.submessages, buildRichContextInfo(quoted), captured.unifiedResponse),
    messageId: generics_1.generateMessageIDV2()
});
exports.generateUnifiedResponseContent = generateUnifiedResponseContent;

const generateRichMessageContent = (submessages, quoted, options) => ({
    message: buildBotForwardedMessage(submessages, buildRichContextInfo(quoted, options)),
    messageId: generics_1.generateMessageIDV2()
});
exports.generateRichMessageContent = generateRichMessageContent;
