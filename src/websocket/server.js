require('dotenv').config();

const {
    WebSocketServer,
    WebSocket
} = require('ws');

const jwt =
    require('jsonwebtoken');

const crypto =
    require('crypto');

const {
    pool
} = require('../database/database');


const PORT =
    process.env.WS_PORT || 3001;


// =====================================
// VALIDATE HOTELNEW FRONTDESK TOKEN
// =====================================

async function validateFrontdeskToken(
    token
) {

    if (!process.env.JWT_SECRET) {

        throw new Error(
            'JWT_SECRET is not configured.'
        );

    }


    // =====================================
    // VERIFY JWT
    // =====================================

    let decoded;


    try {

        decoded =
            jwt.verify(
                token,
                process.env.JWT_SECRET
            );

    } catch (error) {

        throw new Error(
            'Invalid or expired token.'
        );

    }


    if (
        !decoded ||
        !decoded.userId
    ) {

        throw new Error(
            'Invalid token.'
        );

    }


    // =====================================
    // FRONTDESK ONLY
    // PERMISSIONS = 2
    // =====================================

    if (
        Number(
            decoded.PERMISSIONS
        ) !== 2
    ) {

        throw new Error(
            'Frontdesk access required.'
        );

    }


    // =====================================
    // HASH HOTELNEW TOKEN
    // =====================================

    const tokenHash =
        crypto
            .createHash('sha256')
            .update(token)
            .digest('hex');


    // =====================================
    // VERIFY ACTIVE HOTELNEW SESSION
    // =====================================

    const [sessions] =
        await pool.execute(
            `
            SELECT
                us.id

            FROM
                user_sessions us

            INNER JOIN
                user_info ui
                ON ui.IDNo = us.user_id

            WHERE
                us.user_id = ?

                AND us.token_hash = ?

                AND us.active = 1

                AND us.expires_at > NOW()

                AND ui.ACTIVE = 1

                AND ui.PERMISSIONS = 2

            LIMIT 1
            `,
            [
                decoded.userId,
                tokenHash
            ]
        );


    if (
        !sessions ||
        sessions.length === 0
    ) {

        throw new Error(
            'HOTELNEW session is no longer active.'
        );

    }


    return decoded;

}


// =====================================
// WEBSOCKET SERVER
// =====================================

const wss =
    new WebSocketServer({

        port: PORT,

        // Only Apache on this computer
        // should access port 3001 directly.
        host: '127.0.0.1'

    });


// =====================================
// SERVER STARTED
// =====================================

wss.on(
    'listening',
    () => {

        console.log(
            `Secure WebSocket server listening on ws://127.0.0.1:${PORT}`
        );

    }
);


// =====================================
// CLIENT CONNECTION
// =====================================

wss.on(
    'connection',
    (ws) => {

        console.log(
            'HMS/WebSocket client connected - authentication pending'
        );


        ws.pbxAuthorized =
            false;

        ws.pbxUser =
            null;

        ws.pbxToken =
            null;


        // =====================================
        // AUTHENTICATION TIMEOUT
        // =====================================

        const authTimeout =
            setTimeout(
                () => {

                    if (
                        !ws.pbxAuthorized
                    ) {

                        console.warn(
                            'PBX WebSocket client did not authenticate in time.'
                        );


                        ws.close(
                            1008,
                            'Authentication required'
                        );

                    }

                },
                5000
            );


        // =====================================
        // RECEIVE MESSAGE FROM HOTELNEW
        // =====================================

        ws.on(
            'message',
            async (rawData) => {

                try {

                    const message =
                        JSON.parse(
                            rawData.toString()
                        );


                    // =====================================
                    // REQUIRE AUTH MESSAGE FIRST
                    // =====================================

                    if (
                        !ws.pbxAuthorized &&
                        message.type !== 'auth'
                    ) {

                        return;

                    }


                    // =====================================
                    // AUTHENTICATE
                    // =====================================

                    if (
                        message.type === 'auth'
                    ) {

                        if (
                            !message.token ||
                            typeof message.token !==
                                'string'
                        ) {

                            ws.close(
                                1008,
                                'Authentication required'
                            );

                            return;

                        }


                        const user =
                            await validateFrontdeskToken(
                                message.token
                            );


                        ws.pbxAuthorized =
                            true;

                        ws.pbxUser =
                            user;

                        ws.pbxToken =
                            message.token;


                        clearTimeout(
                            authTimeout
                        );


                        console.log(
                            `PBX WebSocket authenticated: user ${user.userId}`
                        );


                        ws.send(
                            JSON.stringify({
                                type:
                                    'auth_ok'
                            })
                        );

                    }


                } catch (error) {

                    console.warn(
                        'PBX WebSocket authentication failed:',
                        error.message
                    );


                    try {

                        ws.send(
                            JSON.stringify({
                                type:
                                    'auth_error',

                                message:
                                    'Authentication failed'
                            })
                        );

                    } catch (_) {
                        // Ignore send errors.
                    }


                    ws.close(
                        1008,
                        'Authentication failed'
                    );

                }

            }
        );


        // =====================================
        // PERIODIC SESSION CHECK
        // =====================================

        const sessionCheckTimer =
            setInterval(
                async () => {

                    if (
                        !ws.pbxAuthorized ||
                        !ws.pbxToken
                    ) {

                        return;

                    }


                    try {

                        await validateFrontdeskToken(
                            ws.pbxToken
                        );

                    } catch (error) {

                        console.warn(
                            'PBX WebSocket HOTELNEW session expired or was revoked.'
                        );


                        ws.pbxAuthorized =
                            false;


                        ws.close(
                            1008,
                            'Session expired'
                        );

                    }

                },
                60000
            );


        // =====================================
        // CLIENT DISCONNECTED
        // =====================================

        ws.on(
            'close',
            () => {

                clearTimeout(
                    authTimeout
                );

                clearInterval(
                    sessionCheckTimer
                );


                console.log(
                    'HMS/WebSocket client disconnected'
                );

            }
        );


        // =====================================
        // CLIENT ERROR
        // =====================================

        ws.on(
            'error',
            (error) => {

                console.error(
                    'PBX WebSocket client error:',
                    error.message
                );

            }
        );

    }
);


// =====================================
// BROADCAST PBX EVENTS
// =====================================

function broadcast(data) {

    const message =
        JSON.stringify(
            data
        );


    for (
        const client
        of wss.clients
    ) {

        // IMPORTANT:
        // Only authenticated Frontdesk
        // clients receive PBX events.

        if (
            client.readyState ===
                WebSocket.OPEN &&

            client.pbxAuthorized ===
                true
        ) {

            client.send(
                message
            );

        }

    }

}


module.exports = {
    broadcast
};