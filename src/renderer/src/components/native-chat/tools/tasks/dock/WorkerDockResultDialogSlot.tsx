import { lazy, Suspense, useLayoutEffect, useRef } from 'react'
import type { WorkerDockResultDialogState } from './use-worker-dock-owner-actions'
import type { WorkerDockRowView } from './WorkerDockRow'
import { returnWorkerDockFocus, workerDockOpenerPane } from './worker-dock-focus-return'
import { useAppStore } from '@/store/index'
import { workspaceCatalogConfirmsAbsence } from '@/store/workspaces/catalog/workspace-catalog-absence'
import type { ExecutionHostId } from '../../../../../../../shared/execution-host/execution-host'

const WorkerDockResultDialog = lazy(() =>
  import('./WorkerDockResultDialog').then((module) => ({
    default: module.WorkerDockResultDialog
  }))
)

/** A settled worker's result dialog, which hands focus back to the row that opened it or, once
 *  that row is gone, to the pill in the same chat pane. */
export function WorkerDockResultDialogSlot({
  dialog,
  hostId,
  ownerActionsAvailable,
  onClose,
  onOpen,
  onRestore
}: {
  dialog: WorkerDockResultDialogState | null
  /** The host the dock reads, whose workspace catalog says whether the worker's workspace is gone. */
  hostId: ExecutionHostId
  ownerActionsAvailable: boolean
  onClose: () => void
  onOpen: (row: WorkerDockRowView) => void
  onRestore: () => void
}) {
  // Read while the opener is on screen: the dialog may outlive its row, and its state is gone by
  // the time it hands focus back.
  const saved = useRef<{ opener: HTMLElement; pane: Element | null } | null>(null)
  const opener = dialog?.opener
  const workspaceId = dialog?.result?.workspaceId
  const workspaceRemoved = useAppStore((state) =>
    Boolean(workspaceId && workspaceCatalogConfirmsAbsence(state, workspaceId, hostId))
  )
  useLayoutEffect(() => {
    if (opener) {
      saved.current = { opener, pane: workerDockOpenerPane(opener) }
    }
  }, [opener])
  return dialog ? (
    <Suspense fallback={null}>
      <WorkerDockResultDialog
        ownerActionsAvailable={
          ownerActionsAvailable && dialog.result?.ownerActionsAvailable !== false
        }
        result={dialog.result}
        row={dialog.row}
        error={dialog.error}
        workspaceRemoved={workspaceRemoved}
        onClose={onClose}
        onOpen={() => onOpen(dialog.row)}
        onRestore={onRestore}
        onReturnFocus={() => {
          if (saved.current) {
            returnWorkerDockFocus(saved.current.opener, saved.current.pane)
          }
        }}
      />
    </Suspense>
  ) : null
}
