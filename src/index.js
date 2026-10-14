const path = require('path');
const fs = require('fs');

// Locate .env beside the executable first.
// Fall back to the project directory when running in development.
const envCandidates = [
    path.join(path.dirname(process.execPath), '.env'),
    path.resolve(process.cwd(), '.env'),
    path.resolve(__dirname, '..', '.env'),
    path.resolve(__dirname, '.env')
];

const envPath = envCandidates.find(file =>
    fs.existsSync(file)
);

if (envPath) {
    require('dotenv').config({ path: envPath });
    console.log(`Environment configuration loaded from: ${envPath}`);
} else {
    console.error('WARNING: .env file was not found.');
}

const {
    cleanupOldCallNotifications
} = require('./database/database');

// =====================================
// PBX CALL HISTORY AUTO CLEANUP
// =====================================

async function runCallHistoryCleanup() {

    try {

        const deletedRows =
            await cleanupOldCallNotifications();

        console.log(
            `PBX history cleanup complete. Deleted ${deletedRows} old record(s).`
        );

    } catch (err) {

        console.error(
            'PBX history cleanup failed:',
            err.message
        );

    }

}


// Run once when Bridge starts
setTimeout(
    runCallHistoryCleanup,
    6000
);


// Run again every 24 hours
setInterval(
    runCallHistoryCleanup,
    24 * 60 * 60 * 1000
);

console.log("3Core PBX Bridge Project Start");
console.log("=================================");
console.log(" Excelltel PBX Bridge Started ");
console.log("=================================");

require('./websocket/server');
require('./http/server');
require('./udp/listener');