const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,

    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0
});

async function testConnection() {
    const connection = await pool.getConnection();

    try {
        await connection.ping();
        console.log('Database connection successful.');
    } finally {
        connection.release();
    }
}

async function getCurrentGuestByRoom(roomNumber) {
    const [rows] = await pool.execute(
        `
        SELECT
            c.NAME AS customerName,
            r.ROOM_NUMBER AS roomNumber
        FROM booking b

        INNER JOIN customer c
            ON c.IDNo = b.CUSTOMER_ID

        INNER JOIN room r
            ON r.IDNo = b.ROOM_ID

        WHERE r.ROOM_NUMBER = ?
          AND b.BOOKING_STATUS = 'check-In'
          AND b.ACTIVE = 1
          AND b.IS_CANCELLED = 0
          AND c.ACTIVE = 1
          AND r.ACTIVE = 1

        ORDER BY b.IDNo DESC
        LIMIT 1
        `,
        [roomNumber]
    );

    return rows[0] || null;
}

async function saveMissedCall(call) {

    const [result] = await pool.execute(
        `
        INSERT INTO pbx_notifications
        (
            NOTIFICATION_TYPE,
            ROOM_NUMBER,
            CUSTOMER_NAME,
            CALLER_EXTENSION,
            DESTINATION_EXTENSION,
            CALL_STARTED_AT,
            CALL_ENDED_AT,
            IS_READ
        )
        VALUES
        (
            'missed_call',
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            0
        )
        `,
        [
            call.roomNumber || call.caller,
            call.customerName || null,
            call.caller,
            call.destination,
            call.startedAt || null,
            call.endedAt || new Date()
        ]
    );

    return result.insertId;
}

async function saveIncomingAnsweredCall(call) {

    const [result] = await pool.execute(
        `
        INSERT INTO pbx_notifications
        (
            NOTIFICATION_TYPE,
            ROOM_NUMBER,
            CUSTOMER_NAME,
            CALLER_EXTENSION,
            DESTINATION_EXTENSION,
            CALL_RESULT,
            CALL_STARTED_AT,
            CALL_ENDED_AT,
            IS_READ
        )

        VALUES (
            'incoming_call',
            ?, ?, ?, ?, 'answered', ?, ?, 0
        )
        `,
        [
            call.roomNumber ||
                call.caller,

            call.customerName ||
                null,

            call.caller,

            call.destination,

            call.startedAt ||
                null,

            call.endedAt ||
                new Date()
        ]
    );

    return result.insertId;
}

async function getCallNotifications(limit = 20) {

    const [rows] = await pool.execute(
        `
        SELECT
            IDNo AS id,

            NOTIFICATION_TYPE AS notificationType,

            ROOM_NUMBER AS roomNumber,
            CUSTOMER_NAME AS customerName,

            CALLER_EXTENSION AS caller,
            DESTINATION_EXTENSION AS destination,

            CALL_RESULT AS callResult,

            CALL_STARTED_AT AS startedAt,
            CALL_ENDED_AT AS endedAt,

            IS_READ AS isRead,
            CREATED_AT AS createdAt

        FROM pbx_notifications

        WHERE NOTIFICATION_TYPE IN (
            'missed_call',
            'incoming_call',
            'outgoing_call'
            )

        ORDER BY IDNo DESC

        LIMIT ?
        `,
        [Number(limit)]
    );

    return rows;
}

async function markNotificationAsRead(notificationId) {

    const [result] = await pool.execute(
        `
        UPDATE pbx_notifications
        SET IS_READ = 1
        WHERE IDNo = ?
        `,
        [notificationId]
    );

    return result.affectedRows > 0;
}

async function markAllNotificationsAsRead() {

    const [result] = await pool.execute(
        `
        UPDATE pbx_notifications
        SET IS_READ = 1
        WHERE IS_READ = 0
        `
    );

    return result.affectedRows;
}

async function markAllNotificationsAsNotRead() {

    const [result] = await pool.execute(
        `
        UPDATE pbx_notifications
        SET IS_READ = 0
        WHERE IS_READ = 1
        `
    );

    return result.affectedRows;
}

async function saveOutgoingCall(call, callResult) {

    const [result] = await pool.execute(
        `
        INSERT INTO pbx_notifications
        (
            NOTIFICATION_TYPE,
            ROOM_NUMBER,
            CUSTOMER_NAME,
            CALLER_EXTENSION,
            DESTINATION_EXTENSION,
            CALL_RESULT,
            CALL_STARTED_AT,
            CALL_ENDED_AT,
            IS_READ
        )
        VALUES
        (
            'outgoing_call',
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            0
        )
        `,
        [
            call.roomNumber || call.destination,
            call.customerName || null,
            call.caller,
            call.destination,
            callResult,
            call.startedAt || null,
            call.endedAt || new Date()
        ]
    );

    return result.insertId;
}

// =====================================
// CLEAN OLD PBX CALL HISTORY
// =====================================

async function cleanupOldCallNotifications() {

    const [result] =
        await pool.execute(
            `
            DELETE FROM pbx_notifications
            WHERE CREATED_AT <
                DATE_SUB(
                    NOW(),
                    INTERVAL 12 MONTH
                )
            `
        );

    return result.affectedRows;
}

module.exports = {
    pool,
    testConnection,
    getCurrentGuestByRoom,
    saveMissedCall,
    getCallNotifications,
    markNotificationAsRead,
    markAllNotificationsAsRead,
    saveOutgoingCall,
    saveIncomingAnsweredCall,
    cleanupOldCallNotifications
};