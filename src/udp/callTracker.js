// =====================================
// EXCELLTEL PBX BRIDGE
// MULTIPLE SIMULTANEOUS CALL TRACKER
// CP832 / D152 COMPATIBLE
// =====================================

class CallTracker {

    constructor() {

        // Store multiple active conversations
        // instead of a single activeCall.

        this.activeCalls = new Map();

    }


    // =====================================
    // PROCESS PBX EVENT
    // =====================================

    processEvent(event) {

        if (!event || !event.type) {
            return null;
        }


        // =====================================
        // NEW CALL / DIAL EVENT
        // =====================================

        if (event.type === 'dial') {

            const callerId = Number(event.callerId);
            const destinationId = Number(event.destinationId);

            if (
                event.callerId == null ||
                event.destinationId == null ||
                !Number.isInteger(callerId) ||
                !Number.isInteger(destinationId)
            ) {
                return null;
            }

            // Unique key for each caller/destination pair.

            const callKey =
                `${callerId}:${destinationId}`;

            const call = {

                caller: event.caller,
                callerId,

                destination: event.destination,
                destinationId,

                callCode: event.callCode,

                state: 'ringing',

                startedAt: new Date()

            };

            // Save the call independently.

            this.activeCalls.set(callKey, call);

            return call;
        }


        // =====================================
        // HOOK EVENT VALIDATION
        // =====================================

        if (
            event.type !== 'off_hook' &&
            event.type !== 'on_hook'
        ) {
            return null;
        }

        const extensionId =
            Number(event.extensionId);

        if (
            event.extensionId == null ||
            !Number.isInteger(extensionId)
        ) {
            return null;
        }


        // =====================================
        // FIND THE CORRECT ACTIVE CALL
        // =====================================

        const matches = [
            ...this.activeCalls.entries()
        ].filter(([, call]) => {

            if (event.type === 'off_hook') {

                // The destination answers the call.

                return (
                    call.destinationId === extensionId &&
                    call.state === 'ringing'
                );
            }

            // Either participant may end the call.

            return (
                call.callerId === extensionId ||
                call.destinationId === extensionId
            );

        });


        // No matching call, or the event cannot
        // be attributed to exactly one conversation.

        if (matches.length !== 1) {

            if (matches.length > 1) {

                console.warn(
                    `PBX CallTracker: Ambiguous ${event.type} ` +
                    `for extension ID ${extensionId}.`
                );

            }

            return null;
        }


        const [callKey, activeCall] = matches[0];


        // =====================================
        // CALL ANSWERED
        // =====================================

        if (event.type === 'off_hook') {

            activeCall.state = 'answered';

            activeCall.answeredAt = new Date();

            return activeCall;
        }


        // =====================================
        // CALL ENDED / UNANSWERED
        // =====================================

        if (event.type === 'on_hook') {

            if (
                activeCall.state !== 'ringing' &&
                activeCall.state !== 'answered'
            ) {
                return null;
            }

            if (activeCall.state === 'ringing') {

                // Call ended before being answered.

                activeCall.state = 'unanswered';

            } else {

                // Previously answered call ended.

                activeCall.state = 'ended';
            }

            activeCall.endedBy = event.extension;

            activeCall.endedAt = new Date();

            // Remove only this completed call.
            // Other conversations remain active.

            this.activeCalls.delete(callKey);

            return activeCall;
        }

        return null;
    }
}

module.exports = CallTracker;