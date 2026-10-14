class CallTracker {
    constructor() {
        this.activeCall = null;
    }

    processEvent(event) {
        if (!event || !event.type) {
            return null;
        }

        // A new call/dial event
        if (event.type === "dial") {
            this.activeCall = {
                caller: event.caller,
                callerId: event.callerId,
                destination: event.destination,
                destinationId: event.destinationId,
                callCode: event.callCode,
                state: "ringing",
                startedAt: new Date()
            };

            return this.activeCall;
        }

        // Called extension goes off-hook.
        // For now, this means the call was answered.
        if (event.type === "off_hook" && this.activeCall) {
            if (event.extensionId === this.activeCall.destinationId) {
                this.activeCall.state = "answered";
                this.activeCall.answeredAt = new Date();
            }

            return this.activeCall;
        }

        // Extension goes on-hook.
        if (event.type === 'on_hook' && this.activeCall) {
    const isCaller =
        event.extensionId === this.activeCall.callerId;

    const isDestination =
        event.extensionId === this.activeCall.destinationId;

    if (!isCaller && !isDestination) {
        return this.activeCall;
    }

    // Call was never answered
    if (this.activeCall.state === 'ringing') {
        this.activeCall.state = 'unanswered';
        this.activeCall.endedBy = event.extension;
        this.activeCall.endedAt = new Date();

        const completedCall = this.activeCall;

        this.activeCall = null;

        return completedCall;
    }

    // Answered call has ended
    if (this.activeCall.state === 'answered') {
        this.activeCall.state = 'ended';
        this.activeCall.endedBy = event.extension;
        this.activeCall.endedAt = new Date();

        const completedCall = this.activeCall;

        this.activeCall = null;

        return completedCall;
    }
}

        return this.activeCall;
    }
}

module.exports = CallTracker;