import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from '../../db/orchestration-db'
import { buildWorkerAttentionContext } from './worker-attention-context'
import { readWorkerDockResult } from '../../dock/worker-dock-read'
import { recordWorkerStop } from '../../dock/worker-dock-owner-stop'
import { projectWorkerFleet } from '../../../rpc/methods/orchestration/worker/fleet/worker-list-projection'

const SESSION = '11111111-1111-4111-8111-111111111111'
const NOW = Date.parse('2026-11-25T12:00:00Z')

let db: OrchestrationDb
beforeEach(() => {
  db = new OrchestrationDb(':memory:')
})
afterEach(() => {
  db.close()
})

function startedWorker(): string {
  const task = db.createTask({ runId: 'run_legacy_local', spec: 'Verify journal writes' })
  const { dispatch } = db.createStartingWorkerDispatch({
    creator: { kind: 'system' },
    maxDepth: 10,
    taskId: task.id,
    startOptions: { agent: 'codex' }
  })
  db.db
    .prepare('UPDATE dispatch_contexts SET creator_orca_session_id = ? WHERE id = ?')
    .run(SESSION, dispatch.id)
  return dispatch.id
}

function stoppedWorker(): string {
  const dispatchId = startedWorker()
  db.db
    .prepare("UPDATE worker_dispatches SET state = 'ready' WHERE dispatch_id = ?")
    .run(dispatchId)
  db.beginWorkerStop(dispatchId, 'epoch_1')
  db.settleWorkerStop(dispatchId)
  return dispatchId
}

/** What the dock's card and worker-show each say about one worker. */
function readings(dispatchId: string) {
  const rows = db.listWorkerTerminalResources({ dispatchIds: [dispatchId], limit: 1 })
  const shown = projectWorkerFleet({
    rows,
    attentionFacts: db.getWorkerAttentionFactsForDispatches([dispatchId], NOW),
    statuses: [],
    limit: 1,
    now: NOW
  }).workers[0]
  return {
    dock: readWorkerDockResult(db, `orca_session_id:${SESSION}`, dispatchId)?.outcome,
    show: shown.outcome,
    attention: attention(dispatchId)
  }
}

function attention(dispatchId: string) {
  const dispatch = db.getDispatchContextById(dispatchId)!
  return buildWorkerAttentionContext({
    db,
    dispatch,
    task: db.getTask(dispatch.task_id),
    evidence: undefined
  }).categories
}

describe('worker attention outcome', () => {
  it('reads a coordinator worker-stop as stopped in the dock and worker-show alike', () => {
    const dispatchId = stoppedWorker()
    recordWorkerStop(db, dispatchId, {
      dispatchId,
      state: 'stopped',
      alreadySettled: false,
      processAction: 'closed_agent_terminal'
    })

    // The stop still fails the Dispatch; only the owner-stop row says someone asked for it.
    expect(db.getDispatchContextById(dispatchId)).toMatchObject({
      status: 'failed',
      last_failure: 'stopped'
    })
    const read = readings(dispatchId)
    expect(read).toMatchObject({ dock: 'stopped', show: 'stopped' })
    expect(read.attention).not.toContain('failure')
  })

  it('reads an unexplained stop as unexpected in the dock and a failure in worker-show alike', () => {
    const dispatchId = stoppedWorker()

    const read = readings(dispatchId)
    expect(read).toMatchObject({ dock: 'unexpected', show: 'failed' })
    expect(read.attention).toContain('failure')
  })

  it('still reads a failed start as a failure', () => {
    const dispatchId = startedWorker()
    db.failWorkerStart(dispatchId, 'verification', 'Verification exited with code 1.')

    expect(attention(dispatchId)).toContain('failure')
  })
})
