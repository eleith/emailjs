import type { Socket } from 'net'

type ReplyHandler = (err: Error | null | undefined, ...rest: unknown[]) => void

/** The write and reply path for one socket. A retired transport is never rebound. */
export class SmtpTransport {
	private writeCount = 0
	private pendingReply?: ReplyHandler
	private pendingOperations = 0
	private finishCleanup?: () => void

	private get idle() {
		return !this.pendingReply && this.pendingOperations === 0
	}

	// A greylist delay or TLS handshake outlives the reply that started it.
	beginOperation() {
		this.pendingOperations++
		return () => {
			this.pendingOperations--
			if (this.idle) this.finishCleanup?.()
		}
	}

	retryAfter(delay: number, retry: () => void) {
		const finish = this.beginOperation()
		setTimeout(() => {
			try {
				retry()
			} finally {
				finish()
			}
		}, delay)
	}

	constructor(
		readonly socket: Socket,
		private readonly log: (entry: unknown) => void,
		private readonly isAttached: (transport: SmtpTransport) => boolean
	) {}

	write(data: string) {
		if (!this.isAttached(this)) return
		this.writeCount++
		this.socket.write(data)
	}

	// Called once by the client whose setup failed, never by a direct login.
	whenIdle(done: () => void) {
		if (this.idle) return done()
		const finish = () => {
			this.finishCleanup = undefined
			this.socket.off('close', onClose)
			done()
		}
		const onClose = () => {
			// A detached socket can't receive another reply, but its operation
			// can still owe the caller a timer or handshake callback.
			if (!this.pendingOperations) finish()
		}
		this.finishCleanup = finish
		this.socket.once('close', onClose)
	}

	trySendRequest(
		request: string,
		onReply: ReplyHandler,
		{ requireIdle = false } = {}
	) {
		const initialWriteCount = this.writeCount
		const hasStayedIdle = () =>
			this.idle && this.writeCount === initialWriteCount
		const canStillSendRequest = () =>
			this.isAttached(this) &&
			this.socket.writable &&
			(!requireIdle || hasStayedIdle())
		if (!canStillSendRequest()) return false
		this.log(request)
		if (!canStillSendRequest()) return false

		const handleReply: ReplyHandler = (err, data, message) => {
			if (this.pendingReply === handleReply) this.pendingReply = undefined
			try {
				if (err) return onReply(err)
				this.log(data)
				onReply(null, data, message)
			} finally {
				if (this.idle) this.finishCleanup?.()
			}
		}
		this.socket.once('response', handleReply)
		// A newListener hook can retire the transport or send a competing request.
		if (!canStillSendRequest()) {
			this.socket.removeListener('response', handleReply)
			return false
		}
		this.pendingReply = handleReply
		this.write(request)
		return true
	}
}
