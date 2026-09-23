"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractCommunityMetadata = exports.makeCommunitiesSocket = void 0;
const WAProto_1 = require("../../WAProto");
const Types_1 = require("../Types");
const Utils_1 = require("../Utils");
const WABinary_1 = require("../WABinary");
const registration_1 = require("./registration");

const makeCommunitiesSocket = (config) => {
    const sock = registration_1.makeRegistrationSocket(config);
    const { authState, ev, query, upsertMessage } = sock;
    const communityQuery = async (jid, type, content) => query({
        tag: "iq",
        attrs: { type, xmlns: "w:g2", to: jid },
        content
    });
    const communityMetadata = async (jid) => {
        const result = await communityQuery(jid, "get", [{ tag: "query", attrs: { request: "interactive" } }]);
        return extractCommunityMetadata(result);
    };
    const communityFetchAllParticipating = async () => {
        const result = await query({
            tag: "iq",
            attrs: { to: "@g.us", xmlns: "w:g2", type: "get" },
            content: [{
                tag: "participating",
                attrs: {},
                content: [
                    { tag: "participants", attrs: {} },
                    { tag: "description", attrs: {} }
                ]
            }]
        });
        const data = {};
        const communitiesChild = WABinary_1.getBinaryNodeChild(result, "communities");
        if (communitiesChild) {
            const communities = WABinary_1.getBinaryNodeChildren(communitiesChild, "community");
            for (const communityNode of communities) {
                const meta = extractCommunityMetadata({ tag: "result", attrs: {}, content: [communityNode] });
                data[meta.id] = meta;
            }
        }
        sock.ev.emit("groups.update", Object.values(data));
        return data;
    };
    const parseGroupResult = async (node) => {
        const groupNode = WABinary_1.getBinaryNodeChild(node, "group");
        if (!groupNode) return null;
        try {
            return await sock.groupMetadata(`${groupNode.attrs.id}@g.us`);
        }
        catch (error) {
            config.logger && config.logger.warn({ error }, "community group metadata parse failed");
            return null;
        }
    };
    if (sock.ws && sock.ws.on) {
        sock.ws.on("CB:ib,,dirty", async (node) => {
            const dirty = WABinary_1.getBinaryNodeChild(node, "dirty");
            if (!dirty || dirty.attrs.type !== "communities") return;
            await communityFetchAllParticipating();
            if (typeof sock.cleanDirtyBits === "function") await sock.cleanDirtyBits("groups");
        });
    }
    return {
        ...sock,
        communityMetadata,
        communityCreate: async (subject, body) => {
            const descriptionId = Utils_1.generateMessageID().substring(0, 12);
            const result = await communityQuery("@g.us", "set", [{
                tag: "create",
                attrs: { subject },
                content: [
                    {
                        tag: "description",
                        attrs: { id: descriptionId },
                        content: [{ tag: "body", attrs: {}, content: Buffer.from(body || "", "utf-8") }]
                    },
                    { tag: "parent", attrs: { default_membership_approval_mode: "request_required" } },
                    { tag: "allow_non_admin_sub_group_creation", attrs: {} },
                    { tag: "create_general_chat", attrs: {} }
                ]
            }]);
            return parseGroupResult(result);
        },
        communityCreateGroup: async (subject, participants, parentCommunityJid) => {
            const result = await communityQuery("@g.us", "set", [{
                tag: "create",
                attrs: { subject, key: Utils_1.generateMessageIDV2() },
                content: [
                    ...(participants || []).map((jid) => ({ tag: "participant", attrs: { jid } })),
                    { tag: "linked_parent", attrs: { jid: parentCommunityJid } }
                ]
            }]);
            return parseGroupResult(result);
        },
        communityLeave: async (id) => {
            await communityQuery("@g.us", "set", [{
                tag: "leave",
                attrs: {},
                content: [{ tag: "community", attrs: { id } }]
            }]);
        },
        communityUpdateSubject: async (jid, subject) => {
            await communityQuery(jid, "set", [{ tag: "subject", attrs: {}, content: Buffer.from(subject, "utf-8") }]);
        },
        communityLinkGroup: async (groupJid, parentCommunityJid) => {
            await communityQuery(parentCommunityJid, "set", [{
                tag: "links",
                attrs: {},
                content: [{ tag: "link", attrs: { link_type: "sub_group" }, content: [{ tag: "group", attrs: { jid: groupJid } }] }]
            }]);
        },
        communityUnlinkGroup: async (groupJid, parentCommunityJid) => {
            await communityQuery(parentCommunityJid, "set", [{
                tag: "unlink",
                attrs: { unlink_type: "sub_group" },
                content: [{ tag: "group", attrs: { jid: groupJid } }]
            }]);
        },
        communityFetchLinkedGroups: async (jid) => {
            let communityJid = jid;
            let isCommunity = false;
            const metadata = await sock.groupMetadata(jid);
            if (metadata && metadata.linkedParent) communityJid = metadata.linkedParent;
            else isCommunity = true;
            const result = await communityQuery(communityJid, "get", [{ tag: "sub_groups", attrs: {} }]);
            const linkedGroups = [];
            const subGroupsNode = WABinary_1.getBinaryNodeChild(result, "sub_groups");
            if (subGroupsNode) {
                for (const groupNode of WABinary_1.getBinaryNodeChildren(subGroupsNode, "group")) {
                    linkedGroups.push({
                        id: groupNode.attrs.id ? WABinary_1.jidEncode(groupNode.attrs.id, "g.us") : undefined,
                        subject: groupNode.attrs.subject || "",
                        creation: groupNode.attrs.creation ? Number(groupNode.attrs.creation) : undefined,
                        owner: groupNode.attrs.creator ? WABinary_1.jidNormalizedUser(groupNode.attrs.creator) : undefined,
                        size: groupNode.attrs.size ? Number(groupNode.attrs.size) : undefined
                    });
                }
            }
            return { communityJid, isCommunity, linkedGroups };
        },
        communityRequestParticipantsList: async (jid) => {
            const result = await communityQuery(jid, "get", [{ tag: "membership_approval_requests", attrs: {} }]);
            const node = WABinary_1.getBinaryNodeChild(result, "membership_approval_requests");
            return WABinary_1.getBinaryNodeChildren(node, "membership_approval_request").map((v) => v.attrs);
        },
        communityRequestParticipantsUpdate: async (jid, participants, action) => {
            const result = await communityQuery(jid, "set", [{
                tag: "membership_requests_action",
                attrs: {},
                content: [{ tag: action, attrs: {}, content: participants.map((id) => ({ tag: "participant", attrs: { jid: id } })) }]
            }]);
            const node = WABinary_1.getBinaryNodeChild(result, "membership_requests_action");
            const nodeAction = WABinary_1.getBinaryNodeChild(node, action);
            return WABinary_1.getBinaryNodeChildren(nodeAction, "participant").map((p) => ({ status: p.attrs.error || "200", jid: p.attrs.jid }));
        },
        communityParticipantsUpdate: async (jid, participants, action) => {
            const result = await communityQuery(jid, "set", [{
                tag: action,
                attrs: action === "remove" ? { linked_groups: "true" } : {},
                content: participants.map((id) => ({ tag: "participant", attrs: { jid: id } }))
            }]);
            const node = WABinary_1.getBinaryNodeChild(result, action);
            return WABinary_1.getBinaryNodeChildren(node, "participant").map((p) => ({ status: p.attrs.error || "200", jid: p.attrs.jid, content: p }));
        },
        communityUpdateDescription: async (jid, description) => {
            const metadata = await communityMetadata(jid);
            const prev = metadata.descId || null;
            await communityQuery(jid, "set", [{
                tag: "description",
                attrs: {
                    ...(description ? { id: Utils_1.generateMessageID() } : { delete: "true" }),
                    ...(prev ? { prev } : {})
                },
                content: description ? [{ tag: "body", attrs: {}, content: Buffer.from(description, "utf-8") }] : undefined
            }]);
        },
        communityInviteCode: async (jid) => {
            const result = await communityQuery(jid, "get", [{ tag: "invite", attrs: {} }]);
            const inviteNode = WABinary_1.getBinaryNodeChild(result, "invite");
            return inviteNode && inviteNode.attrs.code;
        },
        communityRevokeInvite: async (jid) => {
            const result = await communityQuery(jid, "set", [{ tag: "invite", attrs: {} }]);
            const inviteNode = WABinary_1.getBinaryNodeChild(result, "invite");
            return inviteNode && inviteNode.attrs.code;
        },
        communityAcceptInvite: async (code) => {
            const results = await communityQuery("@g.us", "set", [{ tag: "invite", attrs: { code } }]);
            const result = WABinary_1.getBinaryNodeChild(results, "community");
            return result && result.attrs.jid;
        },
        communityRevokeInviteV4: async (communityJid, invitedJid) => {
            const result = await communityQuery(communityJid, "set", [
                { tag: "revoke", attrs: {}, content: [{ tag: "participant", attrs: { jid: invitedJid } }] }
            ]);
            return !!result;
        },
        communityAcceptInviteV4: ev.createBufferedFunction(async (key, inviteMessage) => {
            key = typeof key === "string" ? { remoteJid: key } : key;
            const results = await communityQuery(inviteMessage.groupJid, "set", [{
                tag: "accept",
                attrs: {
                    code: inviteMessage.inviteCode,
                    expiration: inviteMessage.inviteExpiration.toString(),
                    admin: key.remoteJid
                }
            }]);
            if (key.id) {
                inviteMessage = WAProto_1.proto.Message.GroupInviteMessage.fromObject(inviteMessage);
                inviteMessage.inviteExpiration = 0;
                inviteMessage.inviteCode = "";
                ev.emit("messages.update", [{ key, update: { message: { groupInviteMessage: inviteMessage } } }]);
            }
            await upsertMessage({
                key: {
                    remoteJid: inviteMessage.groupJid,
                    id: Utils_1.generateMessageIDV2(sock.user && sock.user.id),
                    fromMe: false,
                    participant: key.remoteJid
                },
                messageStubType: Types_1.WAMessageStubType.GROUP_PARTICIPANT_ADD,
                messageStubParameters: [JSON.stringify(authState.creds.me)],
                participant: key.remoteJid,
                messageTimestamp: Utils_1.unixTimestampSeconds()
            }, "notify");
            return results.attrs.from;
        }),
        communityGetInviteInfo: async (code) => {
            const results = await communityQuery("@g.us", "get", [{ tag: "invite", attrs: { code } }]);
            return extractCommunityMetadata(results);
        },
        communityToggleEphemeral: async (jid, ephemeralExpiration) => {
            const content = ephemeralExpiration
                ? { tag: "ephemeral", attrs: { expiration: ephemeralExpiration.toString() } }
                : { tag: "not_ephemeral", attrs: {} };
            await communityQuery(jid, "set", [content]);
        },
        communitySettingUpdate: async (jid, setting) => {
            await communityQuery(jid, "set", [{ tag: setting, attrs: {} }]);
        },
        communityMemberAddMode: async (jid, mode) => {
            await communityQuery(jid, "set", [{ tag: "member_add_mode", attrs: {}, content: mode }]);
        },
        communityJoinApprovalMode: async (jid, mode) => {
            await communityQuery(jid, "set", [
                { tag: "membership_approval_mode", attrs: {}, content: [{ tag: "community_join", attrs: { state: mode } }] }
            ]);
        },
        communityFetchAllParticipating
    };
};
exports.makeCommunitiesSocket = makeCommunitiesSocket;

const extractCommunityMetadata = (result) => {
    const community = WABinary_1.getBinaryNodeChild(result, "community") || WABinary_1.getBinaryNodeChild(result, "group");
    if (!community) {
        return { id: undefined, subject: "", participants: [], isCommunity: false };
    }
    const descChild = WABinary_1.getBinaryNodeChild(community, "description");
    let desc;
    let descId;
    if (descChild) {
        desc = WABinary_1.getBinaryNodeChildString(descChild, "body");
        descId = descChild.attrs.id;
    }
    const communityId = community.attrs.id && community.attrs.id.includes("@")
        ? community.attrs.id
        : WABinary_1.jidEncode(community.attrs.id || "", "g.us");
    const eph = WABinary_1.getBinaryNodeChild(community, "ephemeral");
    const memberAddMode = WABinary_1.getBinaryNodeChildString(community, "member_add_mode") === "all_member_add";
    return {
        id: communityId,
        subject: community.attrs.subject || "",
        subjectOwner: community.attrs.s_o,
        subjectTime: Number(community.attrs.s_t || 0),
        size: WABinary_1.getBinaryNodeChildren(community, "participant").length,
        creation: Number(community.attrs.creation || 0),
        owner: community.attrs.creator ? WABinary_1.jidNormalizedUser(community.attrs.creator) : undefined,
        desc,
        descId,
        linkedParent: (WABinary_1.getBinaryNodeChild(community, "linked_parent") || {}).attrs && WABinary_1.getBinaryNodeChild(community, "linked_parent").attrs.jid,
        restrict: !!WABinary_1.getBinaryNodeChild(community, "locked"),
        announce: !!WABinary_1.getBinaryNodeChild(community, "announcement"),
        isCommunity: !!WABinary_1.getBinaryNodeChild(community, "parent"),
        isCommunityAnnounce: !!WABinary_1.getBinaryNodeChild(community, "default_sub_community"),
        joinApprovalMode: !!WABinary_1.getBinaryNodeChild(community, "membership_approval_mode"),
        memberAddMode,
        participants: WABinary_1.getBinaryNodeChildren(community, "participant").map(({ attrs }) => ({
            id: attrs.jid,
            phoneNumber: attrs.phone_number,
            lid: attrs.lid,
            admin: attrs.type || null
        })),
        ephemeralDuration: eph && eph.attrs.expiration ? +eph.attrs.expiration : undefined,
        addressingMode: WABinary_1.getBinaryNodeChildString(community, "addressing_mode")
    };
};
exports.extractCommunityMetadata = extractCommunityMetadata;
