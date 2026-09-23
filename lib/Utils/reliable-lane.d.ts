export type ReconnectHint = {
    shouldReconnect: boolean;
    delayMs: number;
    reason: string;
};
export type SendLaneStats = {
    queued: number;
    sent: number;
    retried: number;
    failed: number;
    dropped: number;
    pending: number;
    failedWaiting: number;
    enabled: boolean;
    pauseUntil: number;
};
export type FailedSend = {
    jid: string;
    content: any;
    options: any;
    error: string;
    at: number;
};
export type AntiOverhitConfig = {
    enabled?: boolean;
    maxConcurrentQueries?: number;
    minQueryGapMs?: number;
    maxQueryGapMs?: number;
    maxQueryRetries?: number;
    replyGapMs?: number;
    normalGapMs?: number;
    bulkGapMs?: number;
    burst?: number;
    burstWindowMs?: number;
    replyWindowMs?: number;
    maxSendRetries?: number;
    holdWhileOfflineMs?: number;
    jitterMs?: number;
    failedCap?: number;
};
export declare function suggestReconnect(error: any): ReconnectHint;
export declare function isTransient(err: any): boolean;
export declare function createSendLane(options?: AntiOverhitConfig & {
    logger?: any;
    isOpen?: () => boolean;
}): {
    enqueue(job: {
        jid: string;
        content?: any;
        options?: any;
        run: () => Promise<any>;
        priority?: number | "high" | "normal" | "low";
    }): Promise<any>;
    noteInbound(jid: string): void;
    stats(): SendLaneStats;
    drainFailed(): FailedSend[];
    config: AntiOverhitConfig;
};
export declare function createQueryLane(options?: AntiOverhitConfig & {
    logger?: any;
}): {
    run(node: any, fn: () => Promise<any>): Promise<any>;
    stats(): {
        ran: number;
        coalesced: number;
        retried: number;
        failed: number;
        active: number;
        gapMs: number;
        enabled: boolean;
    };
};
export declare function createOfflineQueue(opts: {
    isOpen: () => boolean;
    onError: (error: Error, identifier: string) => void;
    handlers: Map<string, (node: any) => Promise<void> | void>;
}): {
    enqueue(type: string, node: any): void;
    size(): number;
};
