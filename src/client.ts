import { addressparser, flattenAddressGroups } from './address.js'
import type { MessageAttachment, MessageHeaders } from './message.js'
import { Message } from './message.js'
import { SMTPError, SMTPErrorStates } from './error.js'
import { getSession, type SmtpSession } from './smtp-session.js'
import type { SMTPConnectionOptions } from './connection.js'
import { SMTPConnection, SMTPState } from './connection.js'

export type MessageCallback<T = Message | MessageHeaders> = <
	U extends Error | null,
	V extends (U extends Error ? T : Message),
>(
	err: U,
	msg: V
) => void

export interface MessageStack {
	callback: MessageCallback
	message: Message
	attachment: MessageAttachment
	text: string
	returnPath?: string
	from: string
	to: ReturnType<typeof addressparser>
	cc: string[]
	bcc: string[]
}

function isUnsupportedAuthError(err: Error) {
	return (
		err instanceof SMTPError && err.code === SMTPErrorStates.AUTHNOTSUPPORTED
	)
}

export class SMTPClient {
	public readonly smtp: SMTPConnection
	public readonly queue: MessageStack[] = []

	protected sending = false
	protected ready = false
	protected timer: NodeJS.Timeout | null = null
	private waitingForQuitToFinish = false
	private retiringLoginSession = false

	constructor(server: Partial<SMTPConnectionOptions>) {
		this.smtp = new SMTPConnection(server)
		this.smtp.on('close', () => {
			if (this.timer != null) {
				clearTimeout(this.timer)
				this.timer = null
			}
			if (this.waitingForQuitToFinish) this.resumeQueueAfterQuit()
		})
	}

	public send<T extends Message | MessageHeaders>(
		msg: T,
		callback: MessageCallback<T>
	): void {
		const message =
			msg instanceof Message
				? msg
				: this._canMakeMessage(msg)
					? new Message(msg)
					: null

		if (message == null) {
			callback(new Error('message is not a valid Message instance'), msg)
			return
		}

		const { isValid, validationError } = message.checkValidity()

		if (isValid) {
			const stack = this.createMessageStack(message, callback)
			if (stack.to.length === 0) {
				return callback(new Error('No recipients found in message'), msg)
			}
			this.queue.push(stack)
			this._poll()
		} else {
			callback(new Error(validationError), msg)
		}
	}

	public sendAsync<T extends Message | MessageHeaders>(msg: T) {
		return new Promise<Message | MessageHeaders>((resolve, reject) => {
			this.send(msg, (err, message) => {
				if (err != null) {
					reject(err)
				} else {
					resolve(message)
				}
			})
		})
	}

	public createMessageStack(
		message: Message,
		callback: MessageCallback = function () {
			/* ø */
		}
	) {
		const [{ address: from }] = addressparser(message.header.from)
		const stack = {
			message,
			to: [] as ReturnType<typeof addressparser>,
			from,
			callback: callback.bind(this),
		} as MessageStack

		const {
			header: { to, cc, bcc, 'return-path': returnPath },
		} = message

		if ((typeof to === 'string' || Array.isArray(to)) && to.length > 0) {
			stack.to = flattenAddressGroups(addressparser(to))
		}

		if ((typeof cc === 'string' || Array.isArray(cc)) && cc.length > 0) {
			stack.to = stack.to.concat(
				flattenAddressGroups(addressparser(cc)).filter(
					(x) => stack.to.some((y) => y.address === x.address) === false
				)
			)
		}

		if ((typeof bcc === 'string' || Array.isArray(bcc)) && bcc.length > 0) {
			stack.to = stack.to.concat(
				flattenAddressGroups(addressparser(bcc)).filter(
					(x) => stack.to.some((y) => y.address === x.address) === false
				)
			)
		}

		if (typeof returnPath === 'string' && returnPath.length > 0) {
			const parsedReturnPath = addressparser(returnPath)
			if (parsedReturnPath.length > 0) {
				const [{ address: returnPathAddress }] = parsedReturnPath
				stack.returnPath = returnPathAddress
			}
		}

		return stack
	}

	private resumeQueueAfterQuit() {
		// Defer reconnecting so the old QUIT callback can't close the new connection.
		queueMicrotask(() => {
			if (!this.waitingForQuitToFinish) return
			this.waitingForQuitToFinish = false
			this._poll()
		})
	}

	protected _poll() {
		if (this.waitingForQuitToFinish || this.retiringLoginSession) return

		if (this.timer != null) {
			clearTimeout(this.timer)
		}

		if (this.queue.length) {
			if (this.smtp.state() == SMTPState.NOTCONNECTED) {
				this._connect(this.queue[0])
			} else if (
				this.smtp.state() == SMTPState.CONNECTED &&
				!this.sending &&
				this.ready
			) {
				this._sendmail(this.queue.shift() as MessageStack)
			}
		}
		// Give new mail one second to arrive before closing an idle connection.
		else if (!this.sending && this.smtp.state() == SMTPState.CONNECTED) {
			this.timer = setTimeout(() => {
				this.timer = null
				this.waitingForQuitToFinish = true
				this.ready = false
				this.smtp.quit()
			}, 1000)
		}
	}

	protected _connect(stack: MessageStack) {
		const finishSetup = (err?: Error | null, session?: SmtpSession) => {
			if (err) {
				// The callback may immediately enqueue a retry.
				this.queue.shift()
				if (isUnsupportedAuthError(err)) session?.close()
				if (
					session &&
					err instanceof SMTPError &&
					err.code === SMTPErrorStates.AUTHFAILED
				) {
					// New sends may enqueue, but cannot reconnect ahead of the command
					// that interrupted login, even if the socket has already closed.
					this.retiringLoginSession = true
					try {
						stack.callback(err, stack.message)
					} finally {
						session.closeWhenIdle(() => {
							this.retiringLoginSession = false
							this._poll()
						})
					}
					return
				}
				stack.callback(err, stack.message)
			} else {
				this.ready = true
			}
			this._poll()
		}

		this.ready = false
		this.smtp.connect((err) => {
			if (err) return finishSetup(err)

			const needsLogin = !this.smtp.authorized()
			if (needsLogin) {
				const currentSmtpSession = getSession(this.smtp)
				this.smtp.login((err) => finishSetup(err, currentSmtpSession))
			} else this.smtp.ehlo_or_helo_if_needed((err) => finishSetup(err))
		})
	}

	protected _canMakeMessage(msg: MessageHeaders) {
		return (
			msg.from &&
			(msg.to || msg.cc || msg.bcc) &&
			(msg.text !== undefined || this._containsInlinedHtml(msg.attachment))
		)
	}

	protected _containsInlinedHtml(
		attachment?: MessageAttachment | MessageAttachment[]
	) {
		if (Array.isArray(attachment)) {
			return attachment.some((att) => {
				return this._isAttachmentInlinedHtml(att)
			})
		} else {
			return this._isAttachmentInlinedHtml(attachment)
		}
	}

	protected _isAttachmentInlinedHtml(attachment?: MessageAttachment) {
		return (
			(attachment &&
				(attachment.data || attachment.path) &&
				attachment.alternative === true) ||
			false
		)
	}

	protected _sendsmtp(stack: MessageStack, next: (msg: MessageStack) => void) {
		return (err?: Error | null) => {
			if (!err && next) {
				next.apply(this, [stack])
			} else {
				// if we snag on SMTP commands, call done, passing the error
				// but first reset SMTP state so queue can continue polling
				this.smtp.rset(() => this._senddone(err as Error, stack))
			}
		}
	}

	protected _sendmail(stack: MessageStack) {
		const from = stack.returnPath || stack.from
		this.sending = true
		this.smtp.mail(this._sendsmtp(stack, this._sendrcpt), '<' + from + '>')
	}

	protected _sendrcpt(stack: MessageStack) {
		if (stack.to == null || typeof stack.to === 'string') {
			throw new TypeError('stack.to must be array')
		}

		const to = stack.to.shift()?.address
		this.smtp.rcpt(
			this._sendsmtp(stack, stack.to.length ? this._sendrcpt : this._senddata),
			`<${to}>`
		)
	}

	protected _senddata(stack: MessageStack) {
		this.smtp.data(this._sendsmtp(stack, this._sendmessage))
	}

	protected _sendmessage(stack: MessageStack) {
		const stream = stack.message.stream()

		stream.on('data', (data) => this.smtp.message(data))
		stream.on('end', () => {
			this.smtp.data_end(
				this._sendsmtp(stack, () => this._senddone(null, stack))
			)
		})

		// there is no way to cancel a message while in the DATA portion,
		// so we have to close the socket to prevent a bad email from going out
		stream.on('error', (err) => {
			this.smtp.close()
			this._senddone(err, stack)
		})
	}

	protected _senddone(err: Error | null | undefined, stack: MessageStack) {
		this.sending = false
		stack.callback(err || null, stack.message)
		this._poll()
	}
}
