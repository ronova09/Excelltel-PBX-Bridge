const assert = require('node:assert/strict');

const {
    createExtensionTableAssembler
} = require('./src/protocol/extensionTable');

// =====================================
// CAPTURED PBX EXTENSION TABLE BLOCKS
// =====================================

const tests = [

    // BLOCK 2 - PORTS 33-64
    [
        0x03, 0x80, 32, '511', '620',
        [
            '87 04 01 03 80 80 15 d1 dd dd 15 d2 dd dd 15 d3 dd dd 15 d4 dd dd 15 d5 dd dd 15 d6 dd dd 15 d7 dd dd 15 d8 dd dd 15 d9 dd dd 25 d0 dd dd 25 d1 dd dd 25 d2 dd dd 06 d1 dd dd 06 d2 dd dd 06 d3 dd dd 06 d4 dd dd 06 d5 dd dd 06 d6 dd dd 06 d7 dd dd 06 d8 dd dd 06 d9 dd',

            'dd 16 d0 dd dd 16 d1 dd dd 16 d2 dd dd 16 d3 dd dd 16 d4 dd dd 16 d5 dd dd 16 d6 dd dd 16 d7 dd dd 16 d8 dd dd 16 d9 dd dd 26 d0 dd dd',

            '93'
        ]
    ],

    // BLOCK 3 - PORTS 65-96
    [
        0x04, 0x00, 64, '621', '1108',
        [
            '87 04 01 04 00 80 26 d1 dd dd 26 d2 dd dd 07 d1 dd dd 07 d2 dd dd 07 d3 dd dd 07 d4 dd dd 07 d5 dd dd 07 d6 dd dd 07 d7 dd dd 07 d8 dd dd 07 d9 dd dd 17 d0 dd dd 17 d1 dd dd 17 d2 dd dd 17 d3 dd dd 17 d4 dd dd 17 d5 dd dd 17 d6 dd dd 17 d7 dd dd 17 d8 dd dd 17 d9 dd dd 27 d0 dd dd 27 d1 dd dd 27 d2 dd dd 11 10 dd dd 11 20 dd dd 11 30 dd dd 11 40 dd dd 11 50 dd dd 11 60 dd dd 11 70 dd dd 11',

            '80 dd dd a6'
        ]
    ],

    // BLOCK 4 - PORTS 97-128
    [
        0x04, 0x80, 96, '1109', '6128',
        [
            '87 04 01 04 80 80 11 90 dd dd 11 01 dd dd 11 11 dd dd 11 21 dd dd 11 31 dd dd 11 41 dd dd 11 51 dd dd 11 61 dd dd 11 71 dd dd 16 60 dd dd 16 70 dd dd 16 80 dd dd 16 90 dd dd 16 01 dd dd 16 11 dd dd 16 21 dd dd 16 31 dd dd 16 41 dd dd 16 51 dd dd 16 61 dd dd 16 71 dd dd 16 81 dd dd 16 91 dd dd 16 02 dd dd 03 d0 dd dd 16 22',

            'dd dd 16 32 dd dd 16 42 dd dd 16 52 dd dd 16 62 dd dd 16 72 dd dd 16 82 dd dd 54'
        ]
    ]

];

// =====================================
// EXECUTE MULTI-BLOCK TEST
// =====================================

console.log('===================================');
console.log('D152 MULTI-BLOCK EXTENSION TEST');
console.log('===================================');

for (
    const [
        index,
        offset,
        startId,
        first,
        last,
        fragments
    ] of tests
) {

    const assembler =
        createExtensionTableAssembler(
            2000,
            index,
            offset
        );

    let result;

    for (const hex of fragments) {

        const buffer = Buffer.from(
            hex.replace(/\s/g, ''),
            'hex'
        );

        result = assembler.push(buffer);

    }

    // Verify that the assembler returned a table.
    assert.ok(
        result,
        'Extension table assembly failed'
    );

    // Verify total extension records.
    assert.equal(
        Object.keys(result).length,
        32
    );

    // Verify first extension.
    assert.equal(
        result[startId],
        first
    );

    // Verify last extension.
    assert.equal(
        result[startId + 31],
        last
    );

    // Verify our physical test telephones.
    if (startId === 96) {

        assert.equal(result[104], '1117');
        assert.equal(result[120], '300');

    }

    console.log(
        `IDs ${startId}-${startId + 31}: PASS`
    );

    console.table(result);

}

console.log('===================================');
console.log('ALL MULTI-BLOCK TESTS PASSED');
console.log('===================================');