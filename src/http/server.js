require('dotenv').config();

const express = require('express');
const path = require('path');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const {
    pool,
    getCallNotifications,
    markNotificationAsRead,
    markAllNotificationsAsRead,
    markAllNotificationsAsNotRead
} = require('../database/database');


const app = express();


app.use(express.json());


// =====================================
// LOCAL TEST HMS PAGE
// =====================================

app.get('/', (req, res) => {

    res.sendFile(
        path.join(
            __dirname,
            '../../test-hms.html'
        )
    );

});


// =====================================
// CORS
// =====================================

app.use((req, res, next) => {

    res.header(
        'Access-Control-Allow-Origin',
        req.headers.origin || '*'
    );

    res.header(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization'
    );

    res.header(
        'Access-Control-Allow-Methods',
        'GET, POST, OPTIONS'
    );


    // Allow browser preflight requests
    // without requiring authentication.
    if (req.method === 'OPTIONS') {

        return res.sendStatus(204);

    }


    next();

});


// =====================================
// FRONTDESK AUTHENTICATION
// =====================================

async function requireFrontdesk(
    req,
    res,
    next
) {

    try {

        // =====================================
        // GET BEARER TOKEN
        // =====================================

        const authorization =
            req.headers.authorization || '';


        const match =
            authorization.match(
                /^Bearer\s+(.+)$/i
            );


        if (!match) {

            return res.status(401).json({
                success: false,
                message:
                    'Authentication required'
            });

        }


        const token =
            match[1];


        // =====================================
        // CHECK JWT SECRET
        // =====================================

        if (!process.env.JWT_SECRET) {

            console.error(
                'PBX API: JWT_SECRET is not configured.'
            );


            return res.status(500).json({
                success: false,
                message:
                    'PBX authentication is not configured'
            });

        }


        // =====================================
        // VERIFY HOTELNEW JWT
        // =====================================

        let decoded;


        try {

            decoded =
                jwt.verify(
                    token,
                    process.env.JWT_SECRET
                );

        } catch (error) {

            return res.status(401).json({
                success: false,
                message:
                    'Invalid or expired token'
            });

        }


        if (!decoded || !decoded.userId) {

            return res.status(401).json({
                success: false,
                message:
                    'Invalid token'
            });

        }


        // =====================================
        // FRONTDESK ROLE ONLY
        // PERMISSIONS = 2
        // =====================================

        if (
            Number(decoded.PERMISSIONS) !== 2
        ) {

            return res.status(403).json({
                success: false,
                message:
                    'Frontdesk access required'
            });

        }


        // =====================================
        // HASH TOKEN
        // HOTELNEW uses SHA-256 for
        // user_sessions.token_hash
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

            return res.status(401).json({
                success: false,
                message:
                    'Session expired. Please login again.'
            });

        }


        // =====================================
        // AUTHENTICATED
        // =====================================

        req.user =
            decoded;


        next();


    } catch (error) {

        console.error(
            'PBX API authentication error:',
            error.message
        );


        return res.status(500).json({
            success: false,
            message:
                'Authentication check failed'
        });

    }

}


// =====================================
// PROTECT ALL PBX NOTIFICATION ROUTES
// =====================================

app.use(
    '/api/notifications',
    requireFrontdesk
);


// =====================================
// GET PBX CALL NOTIFICATIONS
// =====================================

app.get(
    '/api/notifications',
    async (req, res) => {

        try {

            const notifications =
                await getCallNotifications(
                    20
                );


            const unreadCount =
                notifications.filter(
                    notification =>
                        Number(
                            notification.isRead
                        ) === 0
                ).length;


            res.json({
                success: true,
                unreadCount,
                notifications
            });


        } catch (err) {

            console.error(
                'Failed to load notifications:',
                err.message
            );


            res.status(500).json({
                success: false,
                error:
                    'Failed to load notifications'
            });

        }

    }
);


// =====================================
// MARK ONE NOTIFICATION AS READ
// =====================================

app.post(
    '/api/notifications/:id/read',
    async (req, res) => {

        try {

            const notificationId =
                Number(
                    req.params.id
                );


            if (
                !Number.isInteger(
                    notificationId
                )
            ) {

                return res.status(400).json({
                    success: false,
                    error:
                        'Invalid notification ID'
                });

            }


            const updated =
                await markNotificationAsRead(
                    notificationId
                );


            if (!updated) {

                return res.status(404).json({
                    success: false,
                    error:
                        'Notification not found'
                });

            }


            console.log(
                `Notification ${notificationId} marked as read.`
            );


            res.json({
                success: true
            });


        } catch (err) {

            console.error(
                'Failed to mark notification as read:',
                err.message
            );


            res.status(500).json({
                success: false,
                error:
                    'Failed to mark notification as read'
            });

        }

    }
);


// =====================================
// MARK ALL NOTIFICATIONS AS READ
// =====================================

app.post(
    '/api/notifications/read-all',
    async (req, res) => {

        try {

            const affectedRows =
                await markAllNotificationsAsRead();


            console.log(
                `Marked ${affectedRows} notifications as read.`
            );


            res.json({
                success: true,
                affectedRows
            });


        } catch (err) {

            console.error(
                'Failed to mark all notifications as read:',
                err.message
            );


            res.status(500).json({
                success: false,
                error:
                    'Failed to mark all notifications as read'
            });

        }

    }
);


// =====================================
// MARK ALL AS NOT READ
// Legacy/test route
// =====================================

app.post(
    '/api/notifications/not-read-all',
    async (req, res) => {

        try {

            if (
                typeof markAllNotificationsAsNotRead
                !== 'function'
            ) {

                return res.status(501).json({
                    success: false,
                    error:
                        'Function not available'
                });

            }


            const affectedRows =
                await markAllNotificationsAsNotRead();


            console.log(
                `Marked ${affectedRows} notifications as not read.`
            );


            res.json({
                success: true,
                affectedRows
            });


        } catch (err) {

            console.error(
                'Failed to mark all notifications as not read:',
                err.message
            );


            res.status(500).json({
                success: false,
                error:
                    'Failed to mark all notifications as not read'
            });

        }

    }
);


// =====================================
// START HTTP SERVER
// =====================================

const PORT =
    process.env.HTTP_PORT || 3000;


// Only Apache / this computer should
// connect directly to the Bridge API.
app.listen(
    PORT,
    '127.0.0.1',
    () => {

        console.log(
            `HTTP API running securely on http://127.0.0.1:${PORT}`
        );

    }
);


module.exports = app;