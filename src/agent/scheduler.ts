import { randomUUID } from 'node:crypto'

export type TurnPriority = 'high' | 'low'

interface QueuedTurn {
  id: string
  message: string
  priority: TurnPriority
  resolve: (result: unknown) => void
  reject: (err: Error) => void
}

const MAX_QUEUE_DEPTH = 50

export class TurnScheduler {
  private highQueue: QueuedTurn[] = []
  private lowQueue: QueuedTurn[] = []
  private _running = false
  private _draining = false

  constructor(private readonly runTurn: (message: string) => Promise<unknown>) {}

  enqueue(message: string, priority: TurnPriority): Promise<unknown> {
    if (this._draining) {
      return Promise.reject(new Error('Agent is draining — not accepting new turns'))
    }
    const depth = this.highQueue.length + this.lowQueue.length
    if (depth >= MAX_QUEUE_DEPTH) {
      return Promise.reject(new Error('Turn queue full — try again later'))
    }
    return new Promise((resolve, reject) => {
      const item: QueuedTurn = { id: randomUUID(), message, priority, resolve, reject }
      if (priority === 'high') {
        this.highQueue.push(item)
      } else {
        this.lowQueue.push(item)
      }
      this._processNext()
    })
  }

  drain(): Promise<void> {
    this._draining = true
    if (!this._running) return Promise.resolve()
    return new Promise(resolve => {
      const check = () => { if (!this._running) resolve(); else setTimeout(check, 100) }
      check()
    })
  }

  isBusy(): boolean { return this._running }

  private _processNext(): void {
    if (this._running) return
    const next = this.highQueue.shift() ?? this.lowQueue.shift()
    if (!next) return
    this._running = true
    this.runTurn(next.message).then(next.resolve, next.reject).finally(() => {
      this._running = false
      this._processNext()
    })
  }
}
