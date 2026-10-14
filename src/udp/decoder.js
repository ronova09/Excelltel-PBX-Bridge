const {
    getExtension
} = require('../protocol/extensionRegistry');

function decodePacket(buffer) {
    if (!Buffer.isBuffer(buffer)) {
        buffer = Buffer.from(buffer);
    }

    if (buffer.length === 0) {
        return {
            type: "empty"
        };
    }

    const packetType = buffer[0];

    /*
     * 04 10 XX YY
     *
     * Extension goes OFF-HOOK
     */
    if (buffer.length >= 4 && buffer[0] === 0x04 && buffer[1] === 0x10) {
        const extensionId = buffer[2];

        return {
            type: "off_hook",
            extension: getExtension(extensionId),
            extensionId: extensionId,
            statusByte: buffer[3],
            raw: buffer.toString("hex")
        };
    }

    /*
     * 04 11 XX YY
     *
     * Extension goes ON-HOOK
     */
    if (buffer.length >= 4 && buffer[0] === 0x04 && buffer[1] === 0x11) {
        const extensionId = buffer[2];

        return {
            type: "on_hook",
            extension: getExtension(extensionId),
            extensionId: extensionId,
            statusByte: buffer[3],
            raw: buffer.toString("hex")
        };
    }

    /*
     * 05 32 DD CC XX
     *
     * DD = destination extension ID
     * CC = caller extension ID
     * XX = currently unknown call-related value
     */
    if (buffer.length >= 5 && buffer[0] === 0x05 && buffer[1] === 0x32) {
        const destinationId = buffer[2];
        const callerId = buffer[3];
        const callCode = buffer[4];

        return {
            type: "dial",
            caller: getExtension(callerId),
            callerId: callerId,
            destination: getExtension(destinationId),
            destinationId: destinationId,
            callCode: `0x${callCode.toString(16).padStart(2, "0")}`,
            raw: buffer.toString("hex")
};
    }

    /*
     * 19 01
     *
     * We have not decoded this packet yet.
     */
    if (buffer.length >= 2 && buffer[0] === 0x19 && buffer[1] === 0x01) {
        return {
            type: "call_record_unknown",
            raw: buffer.toString("hex")
        };
    }

    /*
     * Unknown packet
     */
    return {
        type: "unknown",
        packetType: packetType,
        raw: buffer.toString("hex")
    };
}

module.exports = {
    decodePacket
};