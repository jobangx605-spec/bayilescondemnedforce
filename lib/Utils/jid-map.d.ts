export function rememberLid(lid: string | undefined, pn: string | undefined): void;
export function resolvePn(jid: string | undefined): string | undefined;
export function resolveLid(jid: string | undefined): string | undefined;
export function decodeJid(jid: string): string;
export function toPhoneJid(value: string | undefined): string | undefined;
export function applyMessageJid(msg: any, attrs?: any, meId?: string): any;
