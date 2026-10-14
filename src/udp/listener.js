
const FRONT_DESK_ID = 0;
const dgram = require('dgram');
const { spawn } = require('child_process');

// =====================================
// PBX CONNECTION CONFIGURATION
// =====================================

const PBX_IP = '192.168.110.114';
const PBX_PORT = 50001;

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
    decodeExtensionTable
} = require('../protocol/extensionTable');
const {
    broadcast
} = require('../websocket/server');
const callTracker = new CallTracker();
const socket = dgram.createSocket('udp4');

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


socket.on('listening', () => {
    const addr = socket.address();

    console.log('===================================');
    console.log('PBX UDP Client Started');
    console.log('===================================');
    console.log(`Listening on ${addr.address}:${addr.port}`);

    setTimeout(() => {
    sendPacket(
        '06 05 50 42 58 49',
        PBX_IP,
        PBX_PORT
    );
}, 2000);

    console.log('');
});


socket.on('message', async (msg, rinfo) => {

    console.log('-----------------------------------');
    console.log(`Time   : ${new Date().toLocaleTimeString()}`);
    console.log(`From   : ${rinfo.address}:${rinfo.port}`);
    console.log(`Length : ${msg.length} bytes`);

    // Raw HEX debugging
    // console.log(
    //     `HEX    : ${msg.toString('hex').match(/../g).join(' ')}`
    // );


    // =========================================
    // PBXI REGISTRATION RESPONSE
    // =========================================

    if (
        msg.length === 13 &&
        msg[0] === 0x0D &&
        msg[1] === 0x05
    ) {
        console.log('PBX registration confirmed.');

        setTimeout(() => {

            const request =
                buildExtensionTableRequest(
                    0x03,
                    0x00
                );

            socket.send(
                request,
                50001,
                '192.168.110.114'
            );

            console.log(
                'Extension table request sent:',
                request
                    .toString('hex')
                    .match(/../g)
                    .join(' ')
            );

        }, 500);

        return;
    }


    // =========================================
    // EXTENSION TABLE RESPONSE
    // =========================================

    if (
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
// START UDP LISTENER AND HEALTH MONITOR
// =====================================

socket.bind(0);

startPbxPingMonitor();

module.exports = socket;