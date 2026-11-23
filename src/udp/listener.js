
const FRONT_DESK_ID =
    Number(process.env.PBX_OPERATOR_PORT || 1) - 1;
    
const dgram = require('dgram');
const { spawn } = require('child_process');

// =====================================
// PBX RADAR
// =====================================

const {
    createPbxRadar,
    validRegistration
} = require('./pbxRadar');

// =====================================
// PBX CONNECTION CONFIGURATION
// =====================================

// =====================================
// DYNAMIC PBX CONFIGURATION
// =====================================

let PBX_IP = null;

const PBX_PORT = 50001;

const PBX_RADAR_PREFIX =
    process.env.PBX_RADAR_PREFIX || '192.168.110';

const PBX_PING_INTERVAL_MS = 1000;
const PBX_TIMEOUT_MS = 2000;

const { decodePacket } = require('./decoder');
const CallTracker = require('./callTracker');
const {
    setExtensions
} = require('../protocol/extensionRegistry');
const {
    getCurrentGuestByRoom,
    saveMissedCall,
    saveOutgoingCall,
    saveIncomingAnsweredCall
} = require('../database/database');
const {
    buildExtensionTableRequest
} = require('../protocol/extensionPoll');
const {
    decodeExtensionTable,
    createExtensionTableAssembler
} = require('../protocol/extensionTable');
const {
    broadcast
} = require('../websocket/server');
const callTracker = new CallTracker();
const socket = dgram.createSocket('udp4');

// =====================================
// PBX RADAR INITIALIZATION
// =====================================

const radar = createPbxRadar(socket, {
    prefix: PBX_RADAR_PREFIX,
    port: PBX_PORT
});

let radarSearching = false;
let radarRetryTimer = null;

// =====================================
// PBX EXTENSION TABLE ASSEMBLER
// =====================================

const PBX_FRAGMENTED_TABLE =
    process.env.PBX_FRAGMENTED_TABLE === 'true';

const PBX_EXTENSION_PORTS = 124;

const EXTENSION_BLOCKS = [
    [0x03, 0x00],
    [0x03, 0x80],
    [0x04, 0x00],
    [0x04, 0x80]
];

let extensionAssembler = null;
let extensionBlockIndex = 0;
let extensionResults = {};
let extensionSyncTimer = null;
let extensionSyncReady = false;

const EXTENSION_POLL_TIMEOUT_MS = 3000;

// =====================================
// AUTOMATIC EXTENSION TABLE POLLING
// =====================================

function cancelExtensionSync() {

    clearTimeout(extensionSyncTimer);

    extensionSyncTimer = null;
    extensionAssembler = null;
    extensionSyncReady = false;

}

function startExtensionSync() {

    cancelExtensionSync();

    extensionBlockIndex = 0;
    extensionResults = {};

    console.log('===================================');
    console.log('PBX EXTENSION SYNCHRONIZATION');
    console.log('===================================');

    extensionSyncTimer = setTimeout(
        requestNextExtensionBlock,
        500
    );

}

function requestNextExtensionBlock() {

    // All extension blocks have been received.
    if (extensionBlockIndex >= EXTENSION_BLOCKS.length) {

        const extensions = {};

        for (const [id, extension] of Object.entries(
            extensionResults
        )) {

            if (Number(id) < PBX_EXTENSION_PORTS) {

                extensions[id] = extension;

            }

        }

        // Update the registry only after all blocks
        // have been successfully retrieved.

        setExtensions(extensions);

        extensionAssembler = null;
        extensionSyncReady = true;

        console.log('===================================');
        console.log('EXTENSION SYNCHRONIZATION COMPLETE');
        console.log('===================================');

        // =====================================
// EXTENSION SYNCHRONIZATION STATUS
// =====================================

console.log(
    `PBX Extensions Synchronized: ${
        Object.keys(extensions).length
    } telephone extensions loaded.`
);

        return;

    }

    const [index, offset] =
        EXTENSION_BLOCKS[extensionBlockIndex];

    extensionAssembler =
        createExtensionTableAssembler(
            EXTENSION_POLL_TIMEOUT_MS,
            index,
            offset
        );

    const currentAssembler = extensionAssembler;

    const request =
        buildExtensionTableRequest(index, offset);

    console.log(
        `Requesting extension block ${
            extensionBlockIndex + 1
        }/${EXTENSION_BLOCKS.length}`
    );

    console.log(
        'Request HEX:',
        request.toString('hex').match(/../g).join(' ')
    );

    extensionSyncTimer = setTimeout(() => {

        console.error(
            `Extension block ${
                extensionBlockIndex + 1
            } timed out.`
        );

        cancelExtensionSync();

    }, EXTENSION_POLL_TIMEOUT_MS);

    socket.send(
        request,
        PBX_PORT,
        PBX_IP,
        (err) => {

            if (
                err &&
                extensionAssembler === currentAssembler
            ) {

                console.error(
                    'Extension request failed:',
                    err.message
                );

                cancelExtensionSync();

            }

        }
    );

}

    // =====================================
// PBX REGISTRATION BUFFER
// =====================================

let registrationBuffer = Buffer.alloc(0);
let registrationStartedAt = 0;

const REGISTRATION_LENGTH = 13;
const REGISTRATION_TIMEOUT_MS = 2000;

function resetRegistrationBuffer() {

    registrationBuffer = Buffer.alloc(0);
    registrationStartedAt = 0;

}

function formatDate(date) {
    if (!date) return null;

    return date.toLocaleString('en-PH', {
        timeZone: 'Asia/Manila',
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    });
}

// =====================================
// PBX UDP LISTENER STARTUP
// =====================================

socket.on('listening', () => {

    const addr = socket.address();

    console.log('===================================');
    console.log('PBX UDP Client Started');
    console.log('===================================');

    console.log(
        `Listening on ${addr.address}:${addr.port}`
    );

    console.log('');
    console.log('Initializing PBX Radar...');
    console.log('');

    // Discover the PBX before registration.

    setTimeout(
        discoverAndConnect,
        2000
    );

});

socket.on('message', async (msg, rinfo) => {

        // =====================================
    // PBX RADAR PACKET PROTECTION
    // =====================================

    if (
        radarSearching ||
        !PBX_IP ||
        rinfo.address !== PBX_IP ||
        rinfo.port !== PBX_PORT
    ) {

        return;

    }

    console.log('-----------------------------------');
    console.log(`Time   : ${new Date().toLocaleTimeString()}`);
    console.log(`From   : ${rinfo.address}:${rinfo.port}`);
    console.log(`Length : ${msg.length} bytes`);

    // Raw HEX debugging
    console.log(
         `HEX    : ${msg.toString('hex').match(/../g)?.join(' ') || '(empty)'}`
    );

    // =========================================
// FRAGMENTED REGISTRATION RESPONSE
// =========================================

if (
    PBX_FRAGMENTED_TABLE &&
    rinfo.address === PBX_IP &&
    rinfo.port === PBX_PORT
) {

    const now = Date.now();

    // Discard expired registration fragments.
    if (
        registrationBuffer.length &&
        now - registrationStartedAt >= REGISTRATION_TIMEOUT_MS
    ) {

        resetRegistrationBuffer();

    }

    const isRegistrationHeader =
        msg.length >= 2 &&
        msg[0] === 0x0D &&
        msg[1] === 0x05;

    if (isRegistrationHeader) {

        resetRegistrationBuffer();

        // Registration response is incomplete.
        if (msg.length < REGISTRATION_LENGTH) {

            registrationBuffer = Buffer.from(msg);
            registrationStartedAt = now;

            console.log(
                `Registration fragment received: ${msg.length} bytes`
            );

            console.log(
                'Waiting for remaining registration fragments...'
            );

            return;

        }

    } else if (registrationBuffer.length) {

        const remaining =
            REGISTRATION_LENGTH - registrationBuffer.length;

        // Protect known call events.
        const isCallEvent = (

            (
                msg.length === 4 &&
                msg[0] === 0x04 &&
                (
                    msg[1] === 0x10 ||
                    msg[1] === 0x11
                )
            ) ||

            (
                msg.length === 5 &&
                msg[0] === 0x05 &&
                msg[1] === 0x32
            )

        ) && (
            msg.subarray(0, -1)
                .reduce((xor, byte) => xor ^ byte, 0)
            === msg[msg.length - 1]
        );

        if (!isCallEvent && msg.length <= remaining) {

            console.log(
                `Registration fragment received: ${msg.length} bytes`
            );

            registrationBuffer = Buffer.concat([
                registrationBuffer,
                msg
            ]);

            if (registrationBuffer.length < REGISTRATION_LENGTH) {

                return;

            }

            const assembled = registrationBuffer;

            resetRegistrationBuffer();

            const checksum = assembled
                .subarray(0, -1)
                .reduce((xor, byte) => xor ^ byte, 0);

            if (checksum === assembled[assembled.length - 1]) {

                msg = assembled;

                console.log(
                    'Registration response assembled successfully.'
                );

            } else {

                console.warn(
                    'Registration response rejected: Invalid checksum.'
                );

                return;

            }

        }

    }

}

    // =========================================
// PBXI REGISTRATION RESPONSE
// =========================================

if (validRegistration(msg)) {

    console.log('PBX registration confirmed.');

    if (PBX_FRAGMENTED_TABLE) {

        startExtensionSync();

    } else {

        // Original CP832 polling behavior.

        setTimeout(() => {

            const request =
                buildExtensionTableRequest(
                    0x03,
                    0x00
                );

            socket.send(
                request,
                PBX_PORT,
                PBX_IP
            );

            console.log(
                'Extension table request sent:',
                request.toString('hex')
                    .match(/../g)
                    .join(' ')
            );

        }, 500);

    }

    return;

}

// =========================================
// FRAGMENTED EXTENSION TABLE RESPONSE
// =========================================

// =========================================
// MULTI-BLOCK EXTENSION TABLE RESPONSE
// =========================================

if (PBX_FRAGMENTED_TABLE) {

    // Only accept packets from our configured PBX.

    if (
        rinfo.address !== PBX_IP ||
        rinfo.port !== PBX_PORT
    ) {
        return;
    }

    if (!extensionSyncReady) {

        if (!extensionAssembler) {
            return;
        }

        const [index, offset] =
            EXTENSION_BLOCKS[extensionBlockIndex];

        const expectedHeader = Buffer.from([
            0x87,
            0x04,
            0x01,
            index,
            offset,
            0x80
        ]);

        const isTableHeader =
            msg.subarray(0, 6).equals(expectedHeader);

        const isOtherTableHeader =
            msg.length >= 6 &&
            msg[0] === 0x87 &&
            msg[1] === 0x04 &&
            msg[2] === 0x01 &&
            !isTableHeader;

        // Protect the assembler from unrelated
        // hook and dial events.

        const isCallEvent = (

            (
                msg.length === 4 &&
                msg[0] === 0x04 &&
                (
                    msg[1] === 0x10 ||
                    msg[1] === 0x11
                )
            ) ||

            (
                msg.length === 5 &&
                msg[0] === 0x05 &&
                msg[1] === 0x32
            )

        ) && (
            msg.subarray(0, -1)
                .reduce((xor, byte) => xor ^ byte, 0)
            === msg[msg.length - 1]
        );

        if (
            isOtherTableHeader ||
            isCallEvent
        ) {
            return;
        }

        if (
            isTableHeader ||
            extensionAssembler.isPending()
        ) {

            console.log(
                `Block ${extensionBlockIndex + 1} fragment: ${
                    msg.length
                } bytes`
            );

            const extensions =
                extensionAssembler.push(msg);

            if (extensions !== null) {

                clearTimeout(extensionSyncTimer);
                extensionSyncTimer = null;

                Object.assign(
                    extensionResults,
                    extensions
                );

                console.log(
                    `Block ${
                        extensionBlockIndex + 1
                    }/${EXTENSION_BLOCKS.length} completed.`
                );

                console.log(
                    `Records retrieved: ${
                        Object.keys(extensionResults).length
                    }`
                );

                extensionBlockIndex++;

                requestNextExtensionBlock();

            } else if (extensionAssembler.isPending()) {

                console.log(
                    'Waiting for remaining fragments...'
                );

            } else {

                console.warn(
                    'Extension response rejected: Invalid length or checksum.'
                );

            }

        }

        // Do not process calls until the directory
        // has been completely synchronized.

        return;

    }

}

    // =========================================
    // EXTENSION TABLE RESPONSE
    // =========================================

    if (
        !PBX_FRAGMENTED_TABLE &&
        msg.length >= 134 &&
        msg[0] === 0x87 &&
        msg[1] === 0x04 &&
        msg[2] === 0x01 &&
        msg[3] === 0x03 &&
        msg[4] === 0x00 &&
        msg[5] === 0x80
    ) {
        console.log('Extension table received!');

        // 6-byte header
        // 128-byte extension table
        // final checksum byte
        const tableData = msg.slice(6, 134);

        const extensions =
            decodeExtensionTable(tableData);

        console.log(
            `Extension table loaded: ${
                Object.keys(extensions).length
            } extensions`
        );

        setExtensions(extensions);

        return;
    }


    // =========================================
    // NORMAL PBX EVENT
    // =========================================

    const decoded = decodePacket(msg);

    console.log('Decoded:');
    console.log(decoded);

    const callState =
        callTracker.processEvent(decoded);


    if (callState) {

    // =====================================
    // DETERMINE CALL DIRECTION
    // =====================================

    const isIncomingToOperator =
        callState.destinationId === FRONT_DESK_ID;

    const isOutgoingFromOperator =
        callState.callerId === FRONT_DESK_ID;

        console.log('PBX CALL DEBUG:', {
    state: callState.state,
    caller: callState.caller,
    callerId: callState.callerId,
    destination: callState.destination,
    destinationId: callState.destinationId,
    isIncomingToOperator,
    isOutgoingFromOperator,
    answeredAt: callState.answeredAt
});


    if (isIncomingToOperator) {

        callState.direction = 'incoming';

    } else if (isOutgoingFromOperator) {

        callState.direction = 'outgoing';

    }


    // =====================================
    // LOOK UP ROOM / GUEST
    // =====================================

    if (
        callState.state === 'ringing' &&
        (
            isIncomingToOperator ||
            isOutgoingFromOperator
        )
    ) {

        // Incoming:
        // Room is the caller
        //
        // Outgoing:
        // Room is the destination

        const roomExtension =
            isIncomingToOperator
                ? callState.caller
                : callState.destination;


        try {

            const guest =
                await getCurrentGuestByRoom(
                    Number(roomExtension)
                );


            if (guest) {

                callState.customerName =
                    guest.customerName;

                callState.roomNumber =
                    guest.roomNumber;

            } else {

                callState.customerName =
                    null;

                callState.roomNumber =
                    Number(roomExtension);

            }


        } catch (err) {

            console.error(
                'Guest lookup failed:',
                err.message
            );


            callState.customerName = null;

            callState.roomNumber =
                Number(roomExtension);

        }

    }


    // =====================================
    // SAVE MISSED INCOMING CALL
    // =====================================

    if (
        callState.state === 'unanswered' &&
        isIncomingToOperator
    ) {

        try {

            const notificationId =
                await saveMissedCall(
                    callState
                );


            console.log(
                `Missed call saved. Notification ID: ${notificationId}`
            );


        } catch (err) {

            console.error(
                'Failed to save missed call:',
                err.message
            );

        }

    }

    // =====================================
// SAVE ANSWERED INCOMING CALL
// =====================================

if (
    isIncomingToOperator &&
    callState.state === 'ended' &&
    callState.answeredAt
) {

    try {

        const notificationId =
            await saveIncomingAnsweredCall(
                callState
            );

        console.log(
            `Incoming answered call saved. Notification ID: ${notificationId}`
        );

    } catch (err) {

        console.error(
            'Failed to save incoming answered call:',
            err.message
        );

    }

}

// =====================================
// SAVE OUTGOING OPERATOR CALL
// =====================================

if (
    isOutgoingFromOperator &&
    (
        callState.state === 'ended' ||
        callState.state === 'unanswered'
    )
) {

    try {

        let callResult;

        if (
            callState.state === 'unanswered' ||
            !callState.answeredAt
        ) {

            callResult = 'no_answer';

        } else {

            callResult = 'answered';

        }


        const notificationId =
            await saveOutgoingCall(
                callState,
                callResult
            );


        console.log(
            `Outgoing call saved. Notification ID: ${notificationId}, Result: ${callResult}`
        );


    } catch (err) {

        console.error(
            'Failed to save outgoing call:',
            err.message
        );

    }

}

    // =====================================
    // FORMAT CALL
    // =====================================

    const formattedCall = {

        ...callState,

        startedAt:
            formatDate(
                callState.startedAt
            ),

        answeredAt:
            callState.answeredAt
                ? formatDate(
                    callState.answeredAt
                )
                : null,

        endedAt:
            callState.endedAt
                ? formatDate(
                    callState.endedAt
                )
                : null

    };


    console.log(
        'Call State:'
    );

    console.log(
        formattedCall
    );


    // =====================================
    // SEND ALL OPERATOR CALLS
    // =====================================

    if (
        isIncomingToOperator ||
        isOutgoingFromOperator
    ) {

        broadcast({

            type:
                decoded.type,

            ...formattedCall

        });

    }

}


    console.log('-----------------------------------');
    console.log('');
});


socket.on('error', (err) => {
    console.error(err);
});


function sendPacket(hex, ip, port) {

    const buffer = Buffer.from(
        hex.replace(/\s+/g, ''),
        'hex'
    );

    socket.send(
        buffer,
        port,
        ip,
        (err) => {

            if (err) {
                console.error(
                    'Send Error:',
                    err
                );
            } else {
                console.log(
                    `Sent ${buffer.length} bytes to ${ip}:${port}`
                );

                console.log(`HEX : ${hex}`);
            }
        }
    );
}


// =====================================
// PBX ICMP HEALTH MONITOR
// =====================================

let pingProcess = null;
let pingOutputBuffer = '';

let lastPingSuccessAt = null;
let pingMonitorStartedAt = Date.now();

let pbxMarkedUnreachable = false;
let pingRestartTimer = null;

function startPbxPingMonitor() {

    if (pingProcess) {
        return;
    }

    console.log('===================================');
    console.log('PBX Health Monitor Started');
    console.log(`Target: ${PBX_IP}`);
    console.log(`Ping interval: ${PBX_PING_INTERVAL_MS} ms`);
    console.log(`Failure timeout: ${PBX_TIMEOUT_MS} ms`);
    console.log('===================================');

    pingOutputBuffer = '';

    try {

        pingProcess = spawn(
            'ping.exe',
            [
                '-t',
                '-w',
                String(PBX_PING_INTERVAL_MS),
                PBX_IP
            ],
            {
                windowsHide: true,
                stdio: ['ignore', 'pipe', 'pipe']
            }
        );

        pingProcess.stdout.setEncoding('utf8');

        pingProcess.stdout.on('data', (chunk) => {

            pingOutputBuffer += chunk;

            const lines = pingOutputBuffer.split(/\r?\n/);

            // Preserve a potentially incomplete line.
            pingOutputBuffer = lines.pop() || '';

            for (const line of lines) {

                // A successful Windows IPv4 ping response
                // contains a TTL value.
                if (/TTL\s*=\s*\d+/i.test(line)) {

                    lastPingSuccessAt = Date.now();

                    if (pbxMarkedUnreachable) {

                        pbxMarkedUnreachable = false;

                        console.log('');
                        console.log('===================================');
                        console.log('PBX IS REACHABLE AGAIN');
                        console.log('Reinitializing PBX communication...');
                        console.log('===================================');

                        // Reuse the existing registration packet.
                        sendPacket(
                            '06 05 50 42 58 49',
                            PBX_IP,
                            PBX_PORT
                        );
                    }
                }
            }
        });

        pingProcess.on('error', (err) => {

            console.error(
                'PBX ping process error:',
                err.message
            );

        });

        pingProcess.on('close', (code) => {

            console.warn(
                `PBX ping process stopped (code ${code}).`
            );

            pingProcess = null;

            if (!pingRestartTimer) {

                pingRestartTimer = setTimeout(() => {

                    pingRestartTimer = null;

                    startPbxPingMonitor();

                }, 2000);

            }
        });

    } catch (err) {

        pingProcess = null;

        console.error(
            'Unable to start PBX health monitor:',
            err.message
        );

    }
}


// =====================================
// DETECT PBX TIMEOUT
// =====================================

setInterval(() => {

    // No PBX discovered yet.
    // Do not report false connection timeouts.

    if (!PBX_IP) {
        return;
    }

    const now = Date.now();

    const lastKnownResponse =
        lastPingSuccessAt ?? pingMonitorStartedAt;

    const elapsed = now - lastKnownResponse;

    if (
        elapsed >= PBX_TIMEOUT_MS &&
        !pbxMarkedUnreachable
    ) {

        pbxMarkedUnreachable = true;

        console.error('');
        console.error('===================================');
        console.error('PBX CONNECTION TIMEOUT');
        console.error(`No successful ping for ${Math.floor(elapsed / 1000)} seconds.`);
        console.error('Waiting for the PBX to become reachable.');
        console.error('===================================');
        console.error('');

    }

}, 1000);

// =====================================
// PBX RADAR - AUTOMATIC DISCOVERY
// =====================================

async function discoverAndConnect() {

    // Prevent overlapping scans.
    if (radarSearching || PBX_IP) {
        return;
    }

    radarSearching = true;

    try {

        console.log('');
        console.log('===================================');
        console.log('PBX RADAR SEARCHING');
        console.log(
            `Network: ${PBX_RADAR_PREFIX}.0/24`
        );
        console.log('===================================');

        const discoveredIp =
            await radar.discover();

        // =====================================
        // NO PBX FOUND
        // =====================================

        if (!discoveredIp) {

            console.warn(
                '[RADAR] No PBX found. Retrying in 5 seconds.'
            );

            return;

        }

        // =====================================
        // TARGET ACQUIRED
        // =====================================

        PBX_IP = discoveredIp;

        radarSearching = false;

        console.log('');
        console.log('===================================');
        console.log('PBX RADAR - TARGET ACQUIRED');
        console.log('===================================');

        console.log(`PBX IP   : ${PBX_IP}`);
        console.log(`PBX Port : ${PBX_PORT}`);

        console.log('===================================');

        // =====================================
        // RESET COMMUNICATION STATE
        // =====================================

        resetRegistrationBuffer();

        cancelExtensionSync();

        lastPingSuccessAt = null;

        pingMonitorStartedAt = Date.now();

        pbxMarkedUnreachable = false;

        // =====================================
        // START EXISTING HEALTH MONITOR
        // =====================================

        startPbxPingMonitor();

        // =====================================
        // REGISTER WITH DISCOVERED PBX
        // =====================================

        sendPacket(
            '06 05 50 42 58 49',
            PBX_IP,
            PBX_PORT
        );

    } catch (error) {

        console.error(
            '[RADAR] Discovery failed:',
            error.message
        );

    } finally {

        radarSearching = false;

        // Retry discovery if no PBX was found.

        if (!PBX_IP && !radarRetryTimer) {

            radarRetryTimer = setTimeout(() => {

                radarRetryTimer = null;

                discoverAndConnect();

            }, 5000);

        }

    }

}

// =====================================
// START UDP LISTENER AND HEALTH MONITOR
// =====================================

socket.bind(0);

//startPbxPingMonitor();

module.exports = socket;