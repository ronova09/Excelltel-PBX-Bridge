function decodeExtensionNumber(byte1, byte2) {
    const nibbles = [
        byte1 & 0x0F,
        (byte1 >> 4) & 0x0F,
        byte2 & 0x0F,
        (byte2 >> 4) & 0x0F
    ];

    let extension = "";

    for (const nibble of nibbles) {
        // 0-9 = valid digit
        if (nibble <= 9) {
            extension += nibble.toString();
        }

        // 0xD appears to be padding/filler
    }

    return extension || null;
}

function decodeExtensionTable(buffer) {
    const extensions = {};

    // Each extension record appears to be 4 bytes:
    // [extension byte 1]
    // [extension byte 2]
    // [DD]
    // [DD]

    for (let offset = 0; offset + 3 < buffer.length; offset += 4) {
        const extensionId = offset / 4;

        const byte1 = buffer[offset];
        const byte2 = buffer[offset + 1];

        // Empty record
        if (byte1 === 0xDD && byte2 === 0xDD) {
            continue;
        }

        const extension = decodeExtensionNumber(byte1, byte2);

        if (extension) {
            extensions[extensionId] = extension;
        }
    }

    return extensions;
}

module.exports = {
    decodeExtensionNumber,
    decodeExtensionTable
};