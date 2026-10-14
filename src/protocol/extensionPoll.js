function buildExtensionTableRequest(index = 0x03, offset = 0x00) {
    const packet = Buffer.from([
        0x07,
        0x04,
        0x01,
        index,
        offset,
        0x80,
        0x00 // checksum placeholder
    ]);

    // The last byte is XOR of all preceding bytes
    let checksum = 0;

    for (let i = 0; i < packet.length - 1; i++) {
        checksum ^= packet[i];
    }

    packet[packet.length - 1] = checksum;

    return packet;
}

module.exports = {
    buildExtensionTableRequest
};