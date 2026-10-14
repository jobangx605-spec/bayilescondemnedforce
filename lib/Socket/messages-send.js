"use strict"; 
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
}; 
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeMessagesSocket = void 0;
const boom_1 = require("@hapi/boom");
const node_cache_1 = __importDefault(require("node-cache"));
const WAProto_1 = require("../../WAProto");
const Defaults_1 = require("../Defaults");
const axios_1 = require("axios")
const Types_1 = require("../Types")
const Utils_1 = require("../Utils");
const link_preview_1 = require("../Utils/link-preview");
const WABinary_1 = require("../WABinary");
const username_1 = require("./username");
const WAUSync_1 = require("../WAUSync")
const kelvin = require('./kelvin');
const kikyy = require('./dugong');
var ListType = WAProto_1.proto.Message.ListMessage.ListType;
const makeMessagesSocket = (config) => {
    const {
        logger,
        linkPreviewImageThumbnailWidth, 
        generateHighQualityLinkPreview,
        options: axiosOptions,
        patchMessageBeforeSending
    } = config;
    const sock = (0, username_1.makeUsernameSocket)(config);
    const {
        ev, 
        authState, 
        processingMutex, 
        signalRepository, 
        upsertMessage,
        query,
        fetchPrivacySettings,
        generateMessageTag,
        sendNode, 
        groupMetadata,
        groupToggleEphemeral,
        executeUSyncQuery
    } = sock;
    const userDevicesCache = config.userDevicesCache || new node_cache_1.default({
        stdTTL: Defaults_1.DEFAULT_CACHE_TTLS.USER_DEVICES,
        useClones: false
    });
    const messageRetryManager = new Utils_1.MessageRetryManager(logger, config.maxMsgRetryCount);
    let mediaConn;
    const refreshMediaConn = async (forceGet = false) => {
        const media = await mediaConn;
        if (!media || forceGet || (new Date().getTime() - media.fetchDate.getTime()) > media.ttl * 1000) {
            mediaConn = (async () => {
                const result = await query({
                    tag: 'iq',
                    attrs: {
                        type: 'set',
                        xmlns: 'w:m',
                        to: WABinary_1.S_WHATSAPP_NET,
                    },
                    content: [{ tag: 'media_conn', attrs: {} }]
                });
                const mediaConnNode = WABinary_1.getBinaryNodeChild(result, 'media_conn');
                const node = {
                    hosts: WABinary_1.getBinaryNodeChildren(mediaConnNode, 'host').map(({ attrs }) => ({
                        hostname: attrs.hostname,
                        maxContentLengthBytes: +attrs.maxContentLengthBytes,
                    })),
                    auth: mediaConnNode.attrs.auth,
                    ttl: +mediaConnNode.attrs.ttl,
                    fetchDate: new Date()
                };
                logger.debug('fetched media conn');
                return node;
            })();
        }
        return mediaConn;
    };
    const sendReceipt = async (jid, participant, messageIds, type) => {
        const node = {
            tag: 'receipt',
            attrs: {
                id: messageIds[0],
            },
        };
        const isReadReceipt = type === 'read' || type === 'read-self';
        if (isReadReceipt) {
            node.attrs.t = (0, Utils_1.unixTimestampSeconds)().toString();
        }
        if (type === 'sender' && WABinary_1.isJidUser(jid)) {
            node.attrs.recipient = jid;
            node.attrs.to = participant;
        }
        else {
            node.attrs.to = jid;
            if (participant) {
                node.attrs.participant = participant;
            }
        }
        if (type) {
            node.attrs.type = WABinary_1.isJidNewsLetter(jid) ? 'read-self' : type;
        }
        const remainingMessageIds = messageIds.slice(1);
        if (remainingMessageIds.length) {
            node.content = [
                {
                    tag: 'list',
                    attrs: {},
                    content: remainingMessageIds.map(id => ({
                        tag: 'item',
                        attrs: { id }
                    }))
                }
            ];
        }
        logger.debug({ attrs: node.attrs, messageIds }, 'sending receipt for messages');
        await sendNode(node);
    };
    const sendReceipts = async (keys, type) => {
        const recps = (0, Utils_1.aggregateMessageKeysNotFromMe)(keys);
        for (const { jid, participant, messageIds } of recps) {
            await sendReceipt(jid, participant, messageIds, type);
        }
    };
    const readMessages = async (keys) => {
        const privacySettings = await fetchPrivacySettings();
        const readType = privacySettings.readreceipts === 'all' ? 'read' : 'read-self';
        await sendReceipts(keys, readType);
    };
    const getUSyncDevices = async (jids, useCache, ignoreZeroDevices, meta) => {
        const deviceResults = []

        if (!useCache) {
            logger.debug('not using cache for devices')
        }

        const toFetch = []

        jids = Array.from(new Set(jids))

        for (let jid of jids) {
            const user = WABinary_1.jidDecode(jid)?.user

            jid = WABinary_1.jidNormalizedUser(jid)

            if (useCache) {
                const devices = userDevicesCache.get(user)

                if (devices) {
                    deviceResults.push(...devices)
                    logger.trace({ user }, 'using cache for devices')
                }

                else {
                    toFetch.push(jid)
                }
            }

            else {
                toFetch.push(jid)
            }
        }

        if (!toFetch.length) {
            return deviceResults
        }

        const query = new WAUSync_1.USyncQuery()
            .withContext('message')
            .withDeviceProtocol()

        for (const jid of toFetch) {
            query.withUser(new WAUSync_1.USyncUser().withId(jid))
        }

        const result = await executeUSyncQuery(query)

        if (result) {
            if (meta) {
                meta.sawResult = true;
                meta.emptyUsers = [];
                for (const item of result.list || []) {
                    const decoded = item && item.id ? WABinary_1.jidDecode(item.id) : undefined;
                    const list = item && item.devices && item.devices.deviceList;
                    if (decoded && decoded.user && (!Array.isArray(list) || list.length === 0)) meta.emptyUsers.push(decoded.user);
                }
            }
            const extracted = Utils_1.extractDeviceJids(result?.list, authState.creds.me.id, ignoreZeroDevices)
            const deviceMap = {}

            for (const item of extracted) {
                deviceMap[item.user] = deviceMap[item.user] || []
                deviceMap[item.user].push(item)
                deviceResults.push(item)
            }

            for (const key in deviceMap) {
                userDevicesCache.set(key, deviceMap[key])
            }
        }

        return deviceResults
    }
    const assertSessions = async (jids, force) => {
        let didFetchNewSession = false;
        let jidsRequiringFetch = [];
        if (force) {
            jidsRequiringFetch = jids;
        }
        else {
            const addrs = jids.map(jid => (signalRepository
                .jidToSignalProtocolAddress(jid)));
            const sessions = await authState.keys.get('session', addrs);
            for (const jid of jids) {
                const signalId = signalRepository
                    .jidToSignalProtocolAddress(jid);
                if (!sessions[signalId]) {
                    jidsRequiringFetch.push(jid);
                }
            }
        }
        if (jidsRequiringFetch.length) {
            logger.debug({ jidsRequiringFetch }, 'fetching sessions');
            const result = await query({
                tag: 'iq',
                attrs: {
                    xmlns: 'encrypt',
                    type: 'get',
                    to: WABinary_1.S_WHATSAPP_NET,
                },
                content: [
                    {
                        tag: 'key',
                        attrs: {},
                        content: jidsRequiringFetch.map(jid => ({
                            tag: 'user',
                            attrs: { jid },
                        }))
                    }
                ]
            });
            await (0, Utils_1.parseAndInjectE2ESessions)(result, signalRepository);
            didFetchNewSession = true;
        }
        return didFetchNewSession;
    };
    
 
    const sendPeerDataOperationMessage = async (pdoMessage) => {
        if (!authState.creds.me?.id) {
            throw new boom_1.Boom('Not authenticated')
        }
        
        const protocolMessage = {
            protocolMessage: {
                peerDataOperationRequestMessage: pdoMessage,
                type: WAProto_1.proto.Message.ProtocolMessage.Type.PEER_DATA_OPERATION_REQUEST_MESSAGE
            }
        };
        const meJid = WABinary_1.jidNormalizedUser(authState.creds.me.id);
        const msgId = await relayMessage(meJid, protocolMessage, {
            additionalAttributes: {
                category: 'peer',
                push_priority: 'high_force',
            },
        });
        return msgId;
    };
    const createParticipantNodes = async (jids, message, extraAttrs) => {
        const patched = await patchMessageBeforeSending(message, jids);
        const bytes = (0, Utils_1.encodeWAMessage)(patched);
        let shouldIncludeDeviceIdentity = false;
        const nodes = await Promise.all(jids.map(async (jid) => {
            const { type, ciphertext } = await signalRepository
                .encryptMessage({ jid, data: bytes });
            if (type === 'pkmsg') {
                shouldIncludeDeviceIdentity = true;
            }
            const node = {
                tag: 'to',
                attrs: { jid },
                content: [{
                        tag: 'enc',
                        attrs: {
                            v: '2',
                            type,
                            ...extraAttrs || {}
                        },
                        content: ciphertext
                    }]
            };
            return node;
        }));
        return { nodes, shouldIncludeDeviceIdentity };
    }; 
    const relayMessage = async (jid, message, { messageId: msgId, participant, additionalAttributes, additionalNodes, useUserDevicesCache, cachedGroupMetadata, useCachedGroupMetadata, statusJidList, AI, noSelfSync = false } = {}) => {
        if (AI === undefined) AI = config.aiLabel !== false;
        const meId = authState.creds.me.id;
        let shouldIncludeDeviceIdentity = false;
        let didPushAdditional = false
        const { user, server } = WABinary_1.jidDecode(jid);
        const statusJid = 'status@broadcast';
        const isGroup = server === 'g.us';
        const isStatus = jid === statusJid;
        const isLid = server === 'lid';
        const isPrivate = server === 's.whatsapp.net'
        const isNewsletter = server === 'newsletter';
        msgId = msgId || (0, Utils_1.generateMessageID)();
        useUserDevicesCache = useUserDevicesCache !== false;
        useCachedGroupMetadata = useCachedGroupMetadata !== false && !isStatus
        const participants = [];
        const destinationJid = (!isStatus) ? WABinary_1.jidEncode(user, isLid ? 'lid' : isGroup ? 'g.us' : isNewsletter ? 'newsletter' : 's.whatsapp.net') : statusJid;
        const binaryNodeContent = [];
        const devices = [];
        const meMsg = {
            deviceSentMessage: {
                destinationJid,
                message
            }
        };
        const extraAttrs = {}
        const messages = Utils_1.normalizeMessageContent(message)  
        const buttonType = getButtonType(messages);
        if (participant) {
            if (!isGroup && !isStatus) {
                additionalAttributes = { ...additionalAttributes, 'device_fanout': 'false' };
            }
            const { user, device } = WABinary_1.jidDecode(participant.jid);
            devices.push({ user, device });
        }
        await authState.keys.transaction(async () => {
            const mediaType = getMediaType(messages);
            
            if (mediaType) {
                extraAttrs['mediatype'] = mediaType
            }
            
            if (messages.pinInChatMessage || messages.keepInChatMessage || message.reactionMessage || message.protocolMessage?.editedMessage) {
                extraAttrs['decrypt-fail'] = 'hide'
            } 
            
            if (messages.interactiveResponseMessage?.nativeFlowResponseMessage) {
                extraAttrs['native_flow_name'] = messages.interactiveResponseMessage?.nativeFlowResponseMessage.name
            }
            
            if (isGroup || isStatus) {
                const [groupData, senderKeyMap] = await Promise.all([
                    (async () => {
                        let groupData = useCachedGroupMetadata && cachedGroupMetadata ? await cachedGroupMetadata(jid) : undefined
                        if (groupData) {
                            logger.trace({ jid, participants: groupData.participants.length }, 'using cached group metadata');
                        }

                        else if (!isStatus) {
                            groupData = await groupMetadata(jid)
                        }
                        
                        return groupData;
                    })(),
                    (async () => {
                        if (!participant && !isStatus) {
                            const result = await authState.keys.get('sender-key-memory', [jid])
                            return result[jid] || {}
                        }

                        return {}

                    })()         
                ]);
                if (!participant) {
                    const participantsList = (groupData && !isStatus) ? groupData.participants.map(p => p.id) : []

                    if (isStatus && statusJidList) {
                        participantsList.push(...statusJidList)
                    }

                    const additionalDevices = await getUSyncDevices(participantsList, !!useUserDevicesCache, false)
                    devices.push(...additionalDevices)
                }
                
                const patched = await patchMessageBeforeSending(message, devices.map(d => WABinary_1.jidEncode(d.user, isLid ? 'lid' : 's.whatsapp.net', d.device)));
                const bytes = Utils_1.encodeWAMessage(patched);
                
                const { ciphertext, senderKeyDistributionMessage } = await signalRepository.encryptGroupMessage({
                    group: destinationJid,
                    data: bytes,
                    meId,
                });
                const senderKeyJids = [];
                
                for (const { user, device } of devices) {
                    const jid = WABinary_1.jidEncode(user, (groupData === null || groupData === void 0 ? void 0 : groupData.addressingMode) === 'lid' ? 'lid' : 's.whatsapp.net', device);
                    if (!senderKeyMap[jid] || !!participant) {
                        senderKeyJids.push(jid);
                        senderKeyMap[jid] = true;
                    }
                }
                if (senderKeyJids.length) {
                    logger.debug({ senderKeyJids }, 'sending new sender key');
                    const senderKeyMsg = {
                        senderKeyDistributionMessage: {
                            axolotlSenderKeyDistributionMessage: senderKeyDistributionMessage,
                            groupId: destinationJid
                        }
                    };
                    await assertSessions(senderKeyJids, false);
                    const result = await createParticipantNodes(senderKeyJids, senderKeyMsg, extraAttrs)
                    shouldIncludeDeviceIdentity = shouldIncludeDeviceIdentity || result.shouldIncludeDeviceIdentity;
                    participants.push(...result.nodes);
                }
                binaryNodeContent.push({
                    tag: 'enc',
                    attrs: { v: '2', type: 'skmsg', ...extraAttrs },
                    content: ciphertext
                });
                await authState.keys.set({ 'sender-key-memory': { [jid]: senderKeyMap } });
            }
            else if (isNewsletter) {
                if (message.protocolMessage?.editedMessage) {
                    msgId = message.protocolMessage.key?.id
                    message = message.protocolMessage.editedMessage
                }

                if (message.protocolMessage?.type === WAProto_1.proto.Message.ProtocolMessage.Type.REVOKE) {
                    msgId = message.protocolMessage.key?.id
                    message = {}
                }

                const patched = await patchMessageBeforeSending(message, [])
                const bytes = Utils_1.encodeNewsletterMessage(patched)

                binaryNodeContent.push({
                    tag: 'plaintext',
                    attrs: extraAttrs ? extraAttrs : {},
                    content: bytes
                })
            }
            else {
                const { user: meUser } = WABinary_1.jidDecode(meId);
                if (!participant) {
                    devices.push({ user })
                    if (user !== meUser) {
                        devices.push({ user: meUser })
                    }

                    if (additionalAttributes?.['category'] !== 'peer') {
                        const deviceMeta = {};
                        const additionalDevices = await getUSyncDevices([meId, jid], !!useUserDevicesCache, true, deviceMeta)
                        const meLidUser = authState.creds.me && authState.creds.me.lid ? String(authState.creds.me.lid).split('@')[0].split(':')[0] : undefined;
                        const isSelfChatDestination = user === meUser || (meLidUser && user === meLidUser);
                        if (!isSelfChatDestination && deviceMeta.sawResult && deviceMeta.emptyUsers && deviceMeta.emptyUsers.includes(user)) {
                            throw new boom_1.Boom('No devices resolved for recipient — message was not delivered to the other party', { statusCode: 421, data: { jid } });
                        }

                        devices.push(...additionalDevices)
                    }
                }
                const allJids = [];
                const meJids = [];
                const otherJids = [];
                const meLid = authState.creds.me && authState.creds.me.lid;
                const meLidUser = meLid ? String(meLid).split('@')[0].split(':')[0] : undefined;
                const isSelfChatDestination = user === meUser || (meLidUser && user === meLidUser);
                for (const deviceInfo of devices) {
                    const deviceUser = deviceInfo.user;
                    const device = deviceInfo.device;
                    const isMe = deviceUser === meUser || deviceUser === meLidUser;
                    const encoded = WABinary_1.jidEncode(isMe && isLid ? (meLidUser || deviceUser) : deviceUser, isLid ? 'lid' : 's.whatsapp.net', device);
                    if (noSelfSync && !isSelfChatDestination && isMe) continue;
                    if (isMe) meJids.push(encoded);
                    else otherJids.push(encoded);
                    allJids.push(encoded);
                }
                if (!participant && !isSelfChatDestination && otherJids.length === 0) {
                    throw new boom_1.Boom('No devices resolved for recipient — message was not delivered to the other party', { statusCode: 421, data: { jid } });
                }
                await assertSessions(allJids, false);
                const [{ nodes: meNodes, shouldIncludeDeviceIdentity: s1 }, { nodes: otherNodes, shouldIncludeDeviceIdentity: s2 }] = await Promise.all([
                    createParticipantNodes(meJids, meMsg, extraAttrs),
                    createParticipantNodes(otherJids, message, extraAttrs)
                ])
                participants.push(...meNodes);
                participants.push(...otherNodes);
                shouldIncludeDeviceIdentity = shouldIncludeDeviceIdentity || s1 || s2;
            }
            if (participants.length) {
                if (additionalAttributes?.['category'] === 'peer') {
                    const peerNode = participants[0]?.content?.[0]

                    if (peerNode) {
                        binaryNodeContent.push(peerNode) 
                    }
                }

                else {
                    binaryNodeContent.push({
                        tag: 'participants',
                        attrs: {},
                        content: participants
                    })
                }
            }

            const stanza = {
                tag: 'message',
                attrs: {
                    id: msgId,
                    type: getTypeMessage(messages), 
                    ...(additionalAttributes || {})
                },
                content: binaryNodeContent
            }
            if (participant) {
                if (WABinary_1.isJidGroup(destinationJid)) {
                    stanza.attrs.to = destinationJid;
                    stanza.attrs.participant = participant.jid;
                }
                else if (WABinary_1.areJidsSameUser(participant.jid, meId)) {
                    stanza.attrs.to = participant.jid;
                    stanza.attrs.recipient = destinationJid;
                }
                else {
                    stanza.attrs.to = participant.jid;
                }
            }
            else {
                stanza.attrs.to = destinationJid;
            }
            if (shouldIncludeDeviceIdentity) {
                stanza.content.push({
                    tag: 'device-identity',
                    attrs: {},
                    content: (0, Utils_1.encodeSignedDeviceIdentity)(authState.creds.account, true)
                });
                logger.debug({ jid }, 'adding device identity');
            }
     
            if (AI && !isGroup && !isStatus && !isNewsletter) {
                const botNode = {
                    tag: 'bot', 
                    attrs: {
                        biz_bot: '1'
                    }
                }

                const filteredBizBot = WABinary_1.getBinaryNodeFilter(additionalNodes ? additionalNodes : []) 

                if (filteredBizBot) {
                    stanza.content.push(...additionalNodes) 
                    didPushAdditional = true
                }

                else {
                    stanza.content.push(botNode) 
                }
            }
            
            if(!isNewsletter && buttonType && !isStatus) {             
                const content = WABinary_1.getAdditionalNode(buttonType)
                const filteredNode = WABinary_1.getBinaryNodeFilter(additionalNodes)

                if (filteredNode) {
                    didPushAdditional = true
                    stanza.content.push(...additionalNodes)
                } 
                else {
                    stanza.content.push(...content)
                }
                logger.debug({ jid }, 'adding business node')
            }         

            if (!didPushAdditional && additionalNodes && additionalNodes.length > 0) {
                stanza.content.push(...additionalNodes);
            }
            
            logger.debug({ msgId }, `sending message to ${participants.length} devices`);
            await sendNode(stanza);
            if (messageRetryManager) messageRetryManager.addRecentMessage(jid, msgId, message);
        });
        
        message = Types_1.WAProto.Message.fromObject(message)
    
        const messageJSON = {
            key: {
               remoteJid: jid,
               fromMe: true,
               id: msgId
            },
            message: message,
            messageTimestamp: Utils_1.unixTimestampSeconds(new Date()),
            messageStubParameters: [],
            participant: WABinary_1.isJidGroup(jid) || WABinary_1.isJidStatusBroadcast(jid) ? meId : undefined,
            status: Types_1.WAMessageStatus.PENDING
        }

        return Types_1.WAProto.WebMessageInfo.fromObject(messageJSON)
    };
    const getTypeMessage = (msg) => {
            const message = Utils_1.normalizeMessageContent(msg)  
        if (message.reactionMessage) {
            return 'reaction'
        }       
        else if (getMediaType(message)) {
            return 'media'
        }        
        else {
            return 'text'
        }
    }

    const getMediaType = (message) => {
        if (message.imageMessage) {
            return 'image'
        }
        else if (message.videoMessage) {
            return message.videoMessage.gifPlayback ? 'gif' : 'video'
        }
        else if (message.audioMessage) {
            return message.audioMessage.ptt ? 'ptt' : 'audio'
        }
        else if (message.contactMessage) {
            return 'vcard'
        }
        else if (message.documentMessage) {
            return 'document'
        }
        else if (message.contactsArrayMessage) {
            return 'contact_array'
        }
        else if (message.liveLocationMessage) {
            return 'livelocation'
        }
        else if (message.stickerMessage) {
            return 'sticker'
        }
        else if (message.stickerPackMessage) {
            return 'sticker_pack'
        }
        else if (message.listMessage) {
            return 'list'
        }
        else if (message.listResponseMessage) {
            return 'list_response'
        }
        else if (message.buttonsResponseMessage) {
            return 'buttons_response'
        }
        else if (message.orderMessage) {
            return 'order'
        }
        else if (message.productMessage) {
            return 'product'
        }
        else if (message.interactiveResponseMessage) {
            return 'native_flow_response'
        }
        else if (message.groupInviteMessage) {
            return 'url'
        }
        else if (/https:\/\/wa\.me\/p\/\d+\/\d+/.test(message.extendedTextMessage?.text)) {
            return 'productlink'
        }
    }
 
    const getButtonType = (message) => {
        if (message.listMessage) {
            return 'list'
        }
        else if (message.buttonsMessage) {
            return 'buttons'
        }
        else if (message.interactiveMessage?.nativeFlowMessage?.buttons?.[0]?.name === 'review_and_pay') {
            return 'review_and_pay'
        }
        else if (message.interactiveMessage?.nativeFlowMessage?.buttons?.[0]?.name === 'review_order') {
            return 'review_order'
        }
        else if (message.interactiveMessage?.nativeFlowMessage?.buttons?.[0]?.name === 'payment_info') {
            return 'payment_info'
        }
        else if (message.interactiveMessage?.nativeFlowMessage?.buttons?.[0]?.name === 'payment_status') {
            return 'payment_status'
        }
        else if (message.interactiveMessage?.nativeFlowMessage?.buttons?.[0]?.name === 'payment_method') {
            return 'payment_method'
        }
        else if (message.interactiveMessage && message.interactiveMessage?.nativeFlowMessage) {
            return 'interactive'
        }
        else if (message.interactiveMessage?.nativeFlowMessage) {
            return 'native_flow'
        }
    }
    const getPrivacyTokens = async (jids) => {
        const t = Utils_1.unixTimestampSeconds().toString();
        const result = await query({
            tag: 'iq',
            attrs: {
                to: WABinary_1.S_WHATSAPP_NET,
                type: 'set',
                xmlns: 'privacy'
            },
            content: [
                {
                    tag: 'tokens',
                    attrs: {},
                    content: jids.map(jid => ({
                        tag: 'token',
                        attrs: {
                            jid: WABinary_1.jidNormalizedUser(jid),
                            t,
                            type: 'trusted_contact'
                        }
                    }))
                }
            ]
        });
        return result;
    }  
    const waUploadToServer = (0, Utils_1.getWAUploadToServer)(config, refreshMediaConn);
    const kelvinInstance = new kelvin(Utils_1, waUploadToServer, relayMessage);
    const waitForMsgMediaUpdate = (0, Utils_1.bindWaitForEvent)(ev, 'messages.media-update');
    const messagesApi = {
        ...sock,
        getPrivacyTokens,
        assertSessions,
        relayMessage,
        sendReceipt,
        sendReceipts,
        kelvinInstance,
        readMessages,
        refreshMediaConn,
        getUSyncDevices,
        createParticipantNodes,
        waUploadToServer,
        sendPeerDataOperationMessage,
        fetchPrivacySettings,
        updateMediaMessage: async (message) => {
            const content = (0, Utils_1.assertMediaContent)(message.message);
            const mediaKey = content.mediaKey;
            const meId = authState.creds.me.id;
            const node = (0, Utils_1.encryptMediaRetryRequest)(message.key, mediaKey, meId);
            let error = undefined;
            await Promise.all([
                sendNode(node),
                waitForMsgMediaUpdate(update => {
                    const result = update.find(c => c.key.id === message.key.id);
                    if (result) {
                        if (result.error) {
                            error = result.error;
                        }
                        else {
                            try {
                                const media = (0, Utils_1.decryptMediaRetryData)(result.media, mediaKey, result.key.id);
                                if (media.result !== WAProto_1.proto.MediaRetryNotification.ResultType.SUCCESS) {
                                    const resultStr = WAProto_1.proto.MediaRetryNotification.ResultType[media.result];
                                    throw new boom_1.Boom(`Media re-upload failed by device (${resultStr})`, { data: media, statusCode: (0, Utils_1.getStatusCodeForMediaRetry)(media.result) || 404 });
                                }
                                content.directPath = media.directPath;
                                content.url = (0, Utils_1.getUrlFromDirectPath)(content.directPath);
                                logger.debug({ directPath: media.directPath, key: result.key }, 'media update successful');
                            }
                            catch (err) {
                                error = err;
                            }
                        }
                        return true;
                    }
                })
            ]);
            if (error) {
                throw error;
            }
            ev.emit('messages.update', [
                {
                    key: message.key,
                    update: { 
                        message: message.message
                    }
                }
            ]);
            return message;
        },
        sendMessage: async (jid, content, options = {}) => {
            const userJid = authState.creds.me.id;
            delete options.ephemeralExpiration
            const { filter = false, quoted } = options;
            if (content && typeof content === 'object') {
                const wantAll = content.mentionAll || options.mentionAll || (Array.isArray(content.mentions) && content.mentions.includes('@all'));
                if (wantAll && WABinary_1.isJidGroup(jid)) {
                    try {
                        const meta = await groupMetadata(jid);
                        const mentions = (meta && meta.participants || []).map(p => p.id || p.jid).filter(Boolean);
                        content = { ...content, mentions };
                        delete content.mentionAll;
                    }
                    catch (err) {
                        logger.warn({ err, jid }, 'mentionAll skipped, group metadata unavailable');
                    }
                }
                if ((config.disableLinkPreviews || options.disableLinkPreview) && 'text' in content && content.linkPreview === undefined) {
                    content = { ...content, linkPreview: null };
                }
            }
            const getParticipantAttr = () => ({ ...(filter ? { participant: { jid } } : {}), noSelfSync: options.noSelfSync });
            const messageType = kelvinInstance.detectType(content);
            if (typeof content === 'object' && 'disappearingMessagesInChat' in content &&
                typeof content['disappearingMessagesInChat'] !== 'undefined' && WABinary_1.isJidGroup(jid)) {
                const { disappearingMessagesInChat } = content

                const value = typeof disappearingMessagesInChat === 'boolean' ?
                    (disappearingMessagesInChat ? Defaults_1.WA_DEFAULT_EPHEMERAL : 0) :
                    disappearingMessagesInChat

                await groupToggleEphemeral(jid, value)
            }
            
            else {
                let mediaHandle

   
            if (messageType) {
                switch(messageType) {
                    case 'PAYMENT':
                        const paymentContent = await kelvinInstance.handlePayment(content, quoted);
                        return await relayMessage(jid, paymentContent, {
                            messageId: Utils_1.generateMessageID(),
                            ...getParticipantAttr()
                        });
                
                    case 'PRODUCT':
                        const productContent = await kelvinInstance.handleProduct(content, jid, quoted);
                        const productMsg = await Utils_1.generateWAMessageFromContent(jid, productContent, { quoted });
                        return await relayMessage(jid, productMsg.message, {
                            messageId: productMsg.key.id,
                            ...getParticipantAttr()
                        });
                
                    case 'INTERACTIVE':
                        const interactiveContent = await kelvinInstance.handleInteractive(content, jid, quoted);
                        const interactiveMsg = await Utils_1.generateWAMessageFromContent(jid, interactiveContent, { quoted });
                        return await relayMessage(jid, interactiveMsg.message, {
                            messageId: interactiveMsg.key.id,
                            ...getParticipantAttr()
                        });
                    case 'ALBUM_V2':
                        return await kelvinInstance.handleAlbumV2(content, jid, userJid, options)
                    case 'ALBUM':
                        return await kelvinInstance.handleAlbum(content, jid, quoted)
                    case 'EVENT':
                        return await kelvinInstance.handleEvent(content, jid, quoted)
                    case 'POLL_RESULT':
                        return await kelvinInstance.handlePollResult(content, jid, quoted)
                    case 'GROUP_STORY':
                        return await kelvinInstance.handleGroupStory(content, jid, quoted)
                    case 'STICKER_PACK':
                        const packContent = await kelvinInstance.handleStickerPack(content, jid, quoted);
                        return await relayMessage(jid, packContent, {
                            messageId: Utils_1.generateMessageID(),
                            ...getParticipantAttr()
                        });
                }
            }
            const fullMsg = await Utils_1.generateWAMessage(jid, content, {
                logger,
                userJid,
                quoted,
                getUrlInfo: text => link_preview_1.getUrlInfo(text, {
                    thumbnailWidth: linkPreviewImageThumbnailWidth,
                    fetchOpts: {
                        timeout: 3000,
                        ...axiosOptions || {}
                    },
                    logger,
                    uploadImage: generateHighQualityLinkPreview ? waUploadToServer : undefined
                }),
                upload: async (readStream, opts) => {
                    const up = await waUploadToServer(readStream, {
                        ...opts,
                        newsletter: WABinary_1.isJidNewsLetter(jid)
                    });
                    return up;
                },
                mediaCache: config.mediaCache,
                options: config.options,
                ...options
            });
            
            const isDeleteMsg = 'delete' in content && !!content.delete;
            const isEditMsg = 'edit' in content && !!content.edit;
            const isAiMsg = 'ai' in content && !!content.ai;
            
            const additionalAttributes = {};
            const additionalNodes = [];

            if (isDeleteMsg) {
                const fromMe = content.delete?.fromMe;
                const isGroup = WABinary_1.isJidGroup(content.delete?.remoteJid);
                additionalAttributes.edit = (isGroup && !fromMe) || WABinary_1.isJidNewsLetter(jid) ? '8' : '7';
            } else if (isEditMsg) {
                additionalAttributes.edit = WABinary_1.isJidNewsLetter(jid) ? '3' : '1';
            } else if (isAiMsg) {
                additionalNodes.push({
                    attrs: { 
                        biz_bot: '1' 
                    }, tag: "bot" 
                });
            }
            
            await relayMessage(jid, fullMsg.message, {
                messageId: fullMsg.key.id,
                useCachedGroupMetadata: options.useCachedGroupMetadata !== false,
                cachedGroupMetadata: options.cachedGroupMetadata || (async (groupJid) => {
                    try {
                        return await groupMetadata(groupJid);
                    }
                    catch (_err) {
                        return undefined;
                    }
                }),
                additionalNodes: isAiMsg ? additionalNodes : options.additionalNodes,
                additionalAttributes,
                statusJidList: options.statusJidList,
                noSelfSync: options.noSelfSync
            });
            
            if (config.emitOwnEvents) {
                process.nextTick(() => {
                    processingMutex.mutex(() => upsertMessage(fullMsg, 'append'));
                });
            }
            return fullMsg;
            }
        }
    };
    const sendLane = Utils_1.createSendLane({
        ...(typeof config.antiOverhit === "object" && config.antiOverhit) || {},
        enabled: config.antiOverhit !== false && (!config.antiOverhit || config.antiOverhit.enabled !== false),
        logger,
        isOpen: () => !!(sock.ws && sock.ws.isOpen)
    });
    const rawSendMessage = messagesApi.sendMessage.bind(messagesApi);
    const rawRelayMessage = messagesApi.relayMessage.bind(messagesApi);
    messagesApi.sendMessage = (jid, content, options = {}) => sendLane.enqueue({
        jid,
        content,
        options,
        run: () => rawSendMessage(jid, content, options)
    });
    messagesApi.relayMessage = (jid, message, opts = {}) => sendLane.enqueue({
        jid,
        content: message,
        options: opts,
        priority: opts.priority || "high",
        run: () => rawRelayMessage(jid, message, opts)
    });
    const dugongInstance = new kikyy(Utils_1, waUploadToServer, (jid, message, opts) => messagesApi.relayMessage(jid, message, opts), config, messagesApi);
    messagesApi.sendStatusMention = (content, jids = []) => dugongInstance.sendStatusWhatsApp(content, jids);
    messagesApi.setDisableLinkPreviews = (disabled) => {
        config.disableLinkPreviews = !!disabled;
    };
    messagesApi.antiOverhit = sendLane;
    messagesApi.messageRetryManager = messageRetryManager;
    messagesApi.updateMemberLabel = (jid, memberLabel) => messagesApi.relayMessage(jid, {
        protocolMessage: {
            type: WAProto_1.proto.Message.ProtocolMessage.Type.GROUP_MEMBER_LABEL_CHANGE,
            memberLabel: {
                label: memberLabel ? String(memberLabel).slice(0, 30) : memberLabel,
                labelTimestamp: Utils_1.unixTimestampSeconds()
            }
        }
    }, {
        additionalNodes: [{ tag: "meta", attrs: { tag_reason: "user_update", appdata: "member_tag" } }]
    });
    messagesApi.sendTable = async (jid, title, headers, rows, quoted, options = {}) => {
        const built = Utils_1.generateTableContent(title, headers, rows, quoted, options);
        await messagesApi.relayMessage(jid, built.message, { messageId: built.messageId, noSelfSync: options.noSelfSync });
        return built;
    };
    messagesApi.sendList = async (jid, title, items, quoted, options = {}) => {
        const built = Utils_1.generateListContent(title, items, quoted, options);
        await messagesApi.relayMessage(jid, built.message, { messageId: built.messageId, noSelfSync: options.noSelfSync });
        return built;
    };
    messagesApi.sendCodeBlock = async (jid, code, quoted, options = {}) => {
        const built = Utils_1.generateCodeBlockContent(code, quoted, options);
        await messagesApi.relayMessage(jid, built.message, { messageId: built.messageId, noSelfSync: options.noSelfSync });
        return built;
    };
    messagesApi.sendLatex = async (jid, quoted, options = {}) => {
        const built = Utils_1.generateLatexContent(quoted, options);
        await messagesApi.relayMessage(jid, built.message, { messageId: built.messageId, noSelfSync: options.noSelfSync });
        return built;
    };
    messagesApi.sendLatexImage = async (jid, quoted, options, renderLatexToPng, uploadFn) => {
        const built = await Utils_1.generateLatexImageContent(quoted, options, uploadFn || waUploadToServer, renderLatexToPng);
        await messagesApi.relayMessage(jid, built.message, { messageId: built.messageId, noSelfSync: options && options.noSelfSync });
        return built;
    };
    messagesApi.sendRichMessage = async (jid, submessages, quoted, options = {}) => {
        const built = Utils_1.generateRichMessageContent(submessages, quoted, options);
        await messagesApi.relayMessage(jid, built.message, { messageId: built.messageId, noSelfSync: options.noSelfSync });
        return built;
    };
    messagesApi.sendMessageMembers = async (groupJid, message, options = {}) => {
        const decoded = WABinary_1.jidDecode(groupJid);
        if (!decoded || decoded.server !== "g.us") throw new Error("@g.us server required");
        const meId = authState.creds.me.id;
        const groupData = options.cachedGroupMetadata ? await options.cachedGroupMetadata(groupJid) : await groupMetadata(groupJid);
        const onlyMember = options.onlyMember !== false;
        const admins = (groupData.participants || []).filter((person) => person.admin).map((person) => person.id);
        let targets = (groupData.participants || []).map((person) => person.id);
        if (onlyMember) targets = admins.length ? admins : targets;
        const delayMs = options.delayMs == null ? 1500 : options.delayMs;
        for (let i = 0; i < targets.length; i++) {
            const member = targets[i];
            if (WABinary_1.areJidsSameUser(member, meId)) continue;
            const msgId = `${options.messageId || Utils_1.generateMessageID()}_${i}`;
            const fullMsg = await Utils_1.generateWAMessageFromContent(member, message, { messageId: msgId, quoted: options.quoted });
            await messagesApi.relayMessage(member, fullMsg.message, { messageId: fullMsg.key.id, useUserDevicesCache: options.useUserDevicesCache !== false, noSelfSync: options.noSelfSync });
            if (delayMs && i < targets.length - 1) await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        return { members_total: targets.length };
    };
    return messagesApi;
};
exports.makeMessagesSocket = makeMessagesSocket;
