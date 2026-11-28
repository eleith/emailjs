import type { Socket } from 'net'
import { AuthAdmission, requestVerb } from './auth-admission.js'

type ReplyHandler = (err: Error | null | undefined, ...rest: unknown[]) => void

/** The write and reply path for one socket. A retired transport is never rebound. */
export class SmtpTransport {
	private readonly auth = new AuthAdmission()
	private greetingPaused = false
	private writeCount = 0

	get isAuthenticated() {
		return this.auth.isAuthenticated
	}

	private get available() {
		return this.idle && !this.greetingPaused
	}

	get allowsGreeting() {
		return this.available && this.auth.allowsGreeting
	}
	get allowsLogin() {
		return this.available && this.auth.allowsLogin
	}

	// Logging and registering a listener can both run caller code mid-command.
	// Neither greeting nor login may start until control returns to us.
	private pauseGreetingWhile(fn: () => void) {
		const wasPaused = this.greetingPaused
		this.greetingPaused = true
		try {
			fn()
		} finally {
			this.greetingPaused = wasPaused
		}
	}
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
		private readonly isAttached: (transport: SmtpTransport) => boolean,
		private readonly greetingAccepted: (verb: 'EHLO' | 'HELO') => void
	) {}

	writeBody(data: string) {
		this.pauseGreetingWhile(() => this.log(data))
		if (!this.isAttached(this)) return
		if (this.pendingReply) this.auth.overlap()
		this.auth.untrackedWrite(data)
		this.write(data)
	}

	private write(data: string) {
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
		{ starting }: { starting?: 'auth' | 'greeting' } = {}
	) {
		const initialWriteCount = this.writeCount
		const canStillStart = () => {
			if (this.writeCount !== initialWriteCount) return false
			if (starting === 'auth') return this.allowsLogin
			// A fallback HELO can be inside its own greylist retry timer, but
			// it must never write over another command's pending reply.
			return (
				!this.pendingReply && !this.greetingPaused && this.auth.allowsGreeting
			)
		}
		const canStillSendRequest = () =>
			this.isAttached(this) &&
			this.socket.writable &&
			(!starting || canStillStart())
		if (!canStillSendRequest()) return false
		const verb = requestVerb(request)
		this.pauseGreetingWhile(() => this.log(request))
		if (!canStillSendRequest()) return false

		const handleReply: ReplyHandler = (err, data, message) => {
			if (this.pendingReply === handleReply) this.pendingReply = undefined
			try {
				if (err) return onReply(err)
				const greeting = this.auth.observeReply(
					verb,
					Number((data as { code?: string })?.code)
				)
				if (greeting && this.isAttached(this)) this.greetingAccepted(greeting)
				this.pauseGreetingWhile(() => this.log(data))
				onReply(null, data, message)
			} finally {
				if (this.idle) this.finishCleanup?.()
			}
		}
		this.pauseGreetingWhile(() => this.socket.once('response', handleReply))
		// A newListener hook can retire the transport or send a competing request.
		if (!canStillSendRequest()) {
			this.socket.removeListener('response', handleReply)
			return false
		}
		this.auth.observeRequest(request)
		if (this.pendingReply) this.auth.overlap()
		this.pendingReply = handleReply
		this.write(request)
		return true
	}
}
