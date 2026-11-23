const {
    createExtensionTableAssembler
} = require('./src/protocol/extensionTable');

const assembler = createExtensionTableAssembler();

const packets = [
    '87040103008004d1dddd04d2dddd04d3dddd04d4dddd04d5dddd04d6dddd04d7dddd04d8dddd04d9dddd14d0dddd14d1dddd14d2dddd14d3dddd14d4dddd14d5dddd14d6',

    'dddd14d7dddd14d8dddd14d9dddd24d0dddd24d1dddd24d2dddd05d1dddd05d2dddd05d3dddd05d4dddd05d5dd',

    'dd05d6dddd05d7dddd05d8dddd05d9dddd15d0dddd33'
];

console.log('===================================');
console.log('D152 EXTENSION TABLE TEST');
console.log('===================================');

packets.forEach((hex, index) => {

    const buffer = Buffer.from(hex, 'hex');

    console.log(
        `Packet ${index + 1}: ${buffer.length} bytes`
    );

    const result = assembler.push(buffer);

    if (result) {

        console.log('Extension table assembled successfully.');
        console.table(result);

        console.log(
            'Total extensions:',
            Object.keys(result).length
        );

    } else {

        console.log('Waiting for remaining fragments...');

    }
});