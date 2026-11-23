'use strict';

// ==========================================
// EXCELLTEL PBX RADAR
// AUTOMATIC NETWORK DISCOVERY
// ==========================================

const REGISTRATION_PACKET =
    Buffer.from('060550425849', 'hex');

const RESPONSE_BYTES = 13;


// ==========================================
// VALIDATE PBX REGISTRATION RESPONSE
// ==========================================

function validRegistration(packet) {

    if (
        packet.length !== RESPONSE_BYTES ||
        packet[0] !== 0x0D ||
        packet[1] !== 0x05
    ) {
        return false;
    }

    const checksum = packet
        .subarray(0, -1)
        .reduce(
            (value, byte) => value ^ byte,
            0
        );

    return checksum === packet[packet.length - 1];
}


// ==========================================
// CREATE PBX RADAR
// ==========================================

function createPbxRadar(socket, options = {}) {

    const prefix =
        options.prefix ?? '192.168.110';

    const port =
        options.port ?? 50001;

    const batchSize =
        options.batchSize ?? 4;

    const tickMs =
        options.tickMs ?? 200;

    const graceMs =
        options.graceMs ?? 3000;

    // ======================================
    // VALIDATE CONFIGURATION
    // ======================================

    if (
        !/^(?:\d{1,3}\.){2}\d{1,3}$/.test(prefix) ||
        prefix.split('.').some(
            part => Number(part) > 255
        ) ||
        !Number.isInteger(port) ||
        port < 1 ||
        port > 65535 ||
        !Number.isInteger(batchSize) ||
        batchSize < 1 ||
        !Number.isInteger(tickMs) ||
        tickMs < 1 ||
        !Number.isInteger(graceMs) ||
        graceMs < 1
    ) {
        throw new Error(
            'Invalid PBX Radar configuration.'
        );
    }

    let inProgress = null;


    // ======================================
    // DISCOVER PBX
    // ======================================

    function discover() {

        // Prevent overlapping radar scans.
        if (inProgress) {
            return inProgress;
        }

        inProgress = new Promise(resolve => {

            let nextHost = 1;
            let finished = false;

            let sweepTimer;
            let graceTimer;

            const fragments = new Map();


            // =================================
            // FINISH DISCOVERY
            // =================================

            function finish(address = null) {

                if (finished) return;

                finished = true;

                clearInterval(sweepTimer);
                clearTimeout(graceTimer);

                socket.off('message', onMessage);

                resolve(address);
            }


            // =================================
            // RECEIVE PBX RESPONSES
            // =================================

            function onMessage(packet, remote) {

                if (
                    finished ||
                    remote.port !== port ||
                    !remote.address.startsWith(
                        `${prefix}.`
                    )
                ) {
                    return;
                }

                // Full registration response.
                if (
                    packet.length >= 2 &&
                    packet[0] === 0x0D &&
                    packet[1] === 0x05
                ) {

                    if (validRegistration(packet)) {

                        finish(remote.address);
                        return;
                    }

                    // Handle fragmented responses.
                    if (packet.length < RESPONSE_BYTES) {

                        fragments.set(remote.address, {
                            bytes: Buffer.from(packet),
                            at: Date.now()
                        });
                    }

                    return;
                }

                const pending =
                    fragments.get(remote.address);

                if (!pending) return;

                // Reject expired or oversized fragments.
                if (
                    Date.now() - pending.at > 2000 ||
                    packet.length >
                        RESPONSE_BYTES -
                        pending.bytes.length
                ) {

                    fragments.delete(remote.address);
                    return;
                }

                // Do not confuse call events
                // with registration fragments.
                if (
                    (
                        packet[0] === 0x04 &&
                        (
                            packet[1] === 0x10 ||
                            packet[1] === 0x11
                        )
                    ) ||
                    (
                        packet[0] === 0x05 &&
                        packet[1] === 0x32
                    )
                ) {
                    return;
                }

                const complete = Buffer.concat([
                    pending.bytes,
                    packet
                ]);

                fragments.delete(remote.address);

                if (validRegistration(complete)) {

                    finish(remote.address);

                } else if (
                    complete.length < RESPONSE_BYTES
                ) {

                    fragments.set(remote.address, {
                        bytes: complete,
                        at: pending.at
                    });
                }
            }


            // =================================
            // SEND RADAR PROBES
            // =================================

            function sendBatch() {

                for (
                    let count = 0;
                    count < batchSize &&
                    nextHost <= 254 &&
                    !finished;
                    count++
                ) {

                    const address =
                        `${prefix}.${nextHost++}`;

                    socket.send(
                        REGISTRATION_PACKET,
                        port,
                        address,
                        error => {

                            if (error && !finished) {

                                console.warn(
                                    `[RADAR] Probe to ${address}: ${error.message}`
                                );
                            }
                        }
                    );
                }

                // All addresses have been probed.
                if (
                    nextHost > 254 &&
                    !finished
                ) {

                    clearInterval(sweepTimer);

                    graceTimer = setTimeout(
                        () => finish(null),
                        graceMs
                    );
                }
            }


            // =================================
            // START DISCOVERY
            // =================================

            console.log('');
            console.log('===================================');
            console.log('PBX RADAR INITIALIZED');
            console.log(`Network: ${prefix}.0/24`);
            console.log(`UDP Port: ${port}`);
            console.log('===================================');

            socket.on('message', onMessage);

            sweepTimer = setInterval(
                sendBatch,
                tickMs
            );

            sendBatch();

        }).finally(() => {

            inProgress = null;

        });

        return inProgress;
    }


    return {
        discover
    };
}


module.exports = {
    createPbxRadar,
    validRegistration
};