"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeOfflineNodeProcessor = void 0;

function makeOfflineNodeProcessor(nodeProcessorMap, deps, batchSize = 10) {
    const nodes = [];
    let isProcessing = false;
    const enqueue = (type, node) => {
        nodes.push({ type, node });
        if (isProcessing) return;
        isProcessing = true;
        const promise = async () => {
            let processedInBatch = 0;
            while (nodes.length && deps.isWsOpen()) {
                const item = nodes.shift();
                const nodeProcessor = nodeProcessorMap.get(item.type);
                if (!nodeProcessor) {
                    deps.onUnexpectedError(new Error(`unknown offline node type: ${item.type}`), "processing offline node");
                    continue;
                }
                await nodeProcessor(item.node).catch((err) => deps.onUnexpectedError(err, `processing offline ${item.type}`));
                processedInBatch++;
                if (processedInBatch >= batchSize) {
                    processedInBatch = 0;
                    await deps.yieldToEventLoop();
                }
            }
            isProcessing = false;
            if (nodes.length && deps.isWsOpen()) enqueue(nodes[0].type, nodes[0].node);
        };
        promise().catch((error) => {
            isProcessing = false;
            deps.onUnexpectedError(error, "processing offline nodes");
        });
    };
    return { enqueue, size: () => nodes.length };
}
exports.makeOfflineNodeProcessor = makeOfflineNodeProcessor;
