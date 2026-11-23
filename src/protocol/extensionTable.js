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

function decodeExtensionTable(buffer, startId = 0) {
    const extensions = {};

    // Each extension record appears to be 4 bytes:
    // [extension byte 1]
    // [extension byte 2]
    // [DD]
    // [DD]

    for (let offset = 0; offset + 3 < buffer.length; offset += 4) {
        const extensionId = startId + offset / 4;

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

// =====================================
// PBX EXTENSION TABLE REASSEMBLY
// =====================================

function createExtensionTableAssembler(
    timeoutMs = 2000,
    index = 0x03,
    offset = 0x00
) {

    const address = (index << 8) | offset;

    const startId = (address - 0x0300) / 4;

    const header = Buffer.from([
        0x87,
        0x04,
        0x01,
        index,
        offset,
        0x80
    ]);

    let pending = Buffer.alloc(0);
    let startedAt = 0;

    function reset() {
        pending = Buffer.alloc(0);
        startedAt = 0;
    }

    function push(chunk) {

        const now = Date.now();

        // Discard expired incomplete responses.
        if (
            pending.length &&
            now - startedAt >= timeoutMs
        ) {
            reset();
        }

        // Detect the beginning of an extension table.
        if (
            chunk.subarray(0, header.length).equals(header)
        ) {
            reset();
            startedAt = now;
        } else if (!pending.length) {
            return null;
        }

        // Assemble incoming fragments.
        pending = Buffer.concat([pending, chunk]);

        const expectedLength = header[0];

        // Wait until the complete response arrives.
        if (pending.length < expectedLength) {
            return null;
        }

        const frame = pending;

        reset();

        // Reject invalid packet lengths.
        if (frame.length !== expectedLength) {
            return null;
        }

        // Validate XOR checksum.
        const checksum = frame
            .subarray(0, -1)
            .reduce((xor, byte) => xor ^ byte, 0);

        if (checksum !== frame[frame.length - 1]) {
            return null;
        }

        // Remove the header and checksum.
        const payload = frame.subarray(header.length, -1);

        return decodeExtensionTable(payload, startId);
    }

    function isPending() {

    if (
        pending.length &&
        Date.now() - startedAt >= timeoutMs
    ) {
        reset();
    }

    return pending.length > 0;
}

    return {
        push,
        reset,
        isPending
    };
}

module.exports = {
    decodeExtensionNumber,
    decodeExtensionTable,
    createExtensionTableAssembler
};