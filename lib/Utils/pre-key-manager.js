"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PreKeyManager = void 0;

class PreKeyManager {
    constructor(store, logger) {
        this.store = store;
        this.logger = logger;
        this.tails = new Map();
    }
    queue(keyType, job) {
        const prev = this.tails.get(keyType) || Promise.resolve();
        const next = prev.then(job, job);
        this.tails.set(keyType, next.catch(() => {}));
        return next;
    }
    async processOperations(data, keyType, transactionCache, mutations, isInTransaction) {
        const keyData = data && data[keyType];
        if (!keyData) return;
        return this.queue(keyType, async () => {
            transactionCache[keyType] = transactionCache[keyType] || {};
            mutations[keyType] = mutations[keyType] || {};
            const deletions = [];
            const updates = {};
            for (const keyId in keyData) {
                if (keyData[keyId] === null) deletions.push(keyId);
                else updates[keyId] = keyData[keyId];
            }
            Object.assign(transactionCache[keyType], updates);
            Object.assign(mutations[keyType], updates);
            if (!deletions.length) return;
            if (isInTransaction) {
                for (const keyId of deletions) {
                    if (transactionCache[keyType][keyId]) {
                        transactionCache[keyType][keyId] = null;
                        mutations[keyType][keyId] = null;
                    }
                    else if (this.logger) this.logger.warn(`Skipping deletion of non-existent ${keyType} in transaction: ${keyId}`);
                }
                return;
            }
            const existingKeys = await this.store.get(keyType, deletions);
            for (const keyId of deletions) {
                if (existingKeys && existingKeys[keyId]) {
                    transactionCache[keyType][keyId] = null;
                    mutations[keyType][keyId] = null;
                }
                else if (this.logger) this.logger.warn(`Skipping deletion of non-existent ${keyType}: ${keyId}`);
            }
        });
    }
}
exports.PreKeyManager = PreKeyManager;
