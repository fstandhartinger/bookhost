# Driftglass queue recovery notes

These notes describe a fictional staging service called Driftglass. They were recorded after a training exercise on 2026-08-26 and have not yet been approved for production use. The queue worker imports handbook source files from a local staging inbox. A delayed queue does not by itself prove that an import has failed, and the operator should inspect the evidence before changing service state.

## Recognise the symptom

The exercise began with 12 waiting jobs and 0 active jobs. The worker health endpoint returned 503 while the web interface remained reachable. The relevant log marker was QUEUE_PAUSED. These observations belong to the exercise; the runbook must not claim that every delayed queue will show the same marker or status code. Compare the queue view and the worker log before continuing.

## Inspect safely

Open the staging dashboard and record the current queue counts in the incident note. Check whether a planned maintenance window explains the pause. The exercise used the command `queuectl status --scope staging` to inspect state. This command reads status and does not restart the worker. Do not substitute a production scope when following these training notes.

If the marker is absent, stop this procedure and ask the service owner to investigate. The notes do not include a general diagnosis for database failures, network failures, or damaged uploads. Repeatedly restarting an unknown fault could make the original evidence harder to interpret.

## Recover and verify

After the service owner confirms that maintenance has ended, run `queuectl resume --scope staging`. Wait 30 seconds, then check status again. In the exercise, the waiting count decreased to 8 and the active count became 4. Those figures are evidence from the exercise rather than pass criteria for a future incident. The actual check is whether jobs begin progressing without a new error marker.

## Escalation and gaps

If progress does not resume, preserve the incident note and ask the service owner for the next step. Do not delete queued jobs or source files. A rollback command, an on-call contact, and a maximum retry count are not documented. The reviewer should confirm the command against the staging tooling, identify the escalation contact, and decide how to link the approved production procedure once it exists. These notes must remain explicitly labelled as a staging exercise until that review is complete.
