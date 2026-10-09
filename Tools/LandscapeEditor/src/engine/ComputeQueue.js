//============================================================================================================================================
//                                                              COMPUTEQUEUE.JS
//============================================================================================================================================
// 📦 Tools/LandscapeEditor/src/engine/ComputeQueue.js — Latest-wins compute queue: one evaluation in flight at a time, with the
//    newest pending project replacing any older waiting request.

//------------------------------------------------------------------------------------------------------------------------
//                                                         QUEUE
//------------------------------------------------------------------------------------------------------------------------
// Edits arrive faster than a 256 to 512 grid can evaluate, so only the most recent project is kept waiting. Stale results are dropped by request id.
export function createComputeQueue(worker, handlers)
{
    let inFlight = 0;
    let pending = null;
    let issued = 0;

    const dispatch = () =>
    {
        if (inFlight !== 0 || pending === null)
        {
            return;
        }
        const job = pending;
        pending = null;
        issued += 1;
        inFlight = issued;
        if (handlers.onStart)
        {
            handlers.onStart();
        }
        worker.postMessage({ requestId: inFlight, project: job.project, viewId: job.viewId });
    };

    worker.onmessage = (event) =>
    {
        const message = event.data;
        if (message.requestId !== inFlight)
        {
            return;
        }
        inFlight = 0;
        if (message.type === 'error')
        {
            handlers.onError(message.message);
        }
        else
        {
            handlers.onResult(message);
        }
        dispatch();
    };

    worker.onerror = (event) =>
    {
        inFlight = 0;
        handlers.onError(event.message || 'The compute worker stopped unexpectedly.');
        dispatch();
    };

    return {
        submit(job)
        {
            pending = job;
            dispatch();
        },
        dispose()
        {
            worker.terminate();
        }
    };
}
