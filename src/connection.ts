import { EventEmitter } from 'events'
import { Socket } from 'net'
import { hostname } from 'os'
import { connect, TLSSocket } from 'tls'
import type { ConnectionOptions } from 'tls'

import { SMTPError, SMTPErrorStates } from './error.js'
import { DataTransfer } from './smtp-data.js'
import { SMTPResponseMonitor } from './response.js'
import { startSession, endSession } from './smtp-session.js'
import { SmtpTransport } from './smtp-transport.js'
import { startTlsHandshake } from './tls-upgrade.js'

import {
	AUTH_METHODS,
	authenticateWith,
	selectAuthMethod,
} from './smtp-auth.js'

export { AUTH_METHODS }

export const SMTPState = {
	NOTCONNECTED: 0,
	CONNECTING: 1,
	CONNECTED: 2,
} as const

export const DEFAULT_TIMEOUT = 5000

const SMTP_PORT = 25
const SMTP_SSL_PORT = 465
const SMTP_TLS_PORT = 587
const CRLF = '\r\n'
const GREYLIST_DELAY = 300

let DEBUG: 0 | 1 = 0

const log = (...args: unknown[]) => {
	if (DEBUG === 1) {
		args.forEach((d) =>
			console.log(
				typeof d === 'object'
					? d instanceof Error
						? d.message
						: JSON.stringify(d)
					: d
			)
		)
	}
}

const caller = (callback?: CallbackFn, ...args: Parameters<CallbackFn>) => {
	if (typeof callback === 'function') {
		callback(...args)
	}
}

type CallbackFn = (err: Error | null | undefined, ...rest: unknown[]) => void
type CommandCallback = (err: Error | null | undefined, data?: unknown) => void
type SmtpRequestSender = (request: string, onReply: CommandCallback) => void

export type SMTPSocketOptions = Omit<
	ConnectionOptions,
	'port' | 'host' | 'path' | 'socket' | 'timeout' | 'secureContext'
>

export interface SMTPConnectionOptions {
	timeout: number | null
	user: string
	password: string
	domain: string
	host: string
	port: number
	ssl: boolean | SMTPSocketOptions
	tls: boolean | SMTPSocketOptions
	authentication: (keyof typeof AUTH_METHODS)[]
	logger: (...args: unknown[]) => void
}

export interface ConnectOptions {
	ssl?: boolean
}

// A relay rejection is still a reply. Preserve transport errors such as timeouts.
function isRelayReply(err: Error | null | undefined) {
	return (
		!err ||
		(err instanceof SMTPError && err.code === SMTPErrorStates.BADRESPONSE)
	)
}

export class SMTPConnection extends EventEmitter {
	public readonly user: () => string
	public readonly password: () => string
	public readonly timeout: number = DEFAULT_TIMEOUT

	protected readonly log = log
	protected readonly authentication: (keyof typeof AUTH_METHODS)[] = [
		AUTH_METHODS['CRAM-MD5'],
		AUTH_METHODS.LOGIN,
		AUTH_METHODS.PLAIN,
		AUTH_METHODS.XOAUTH2,
	]

	protected _state: 0 | 1 | 2 = SMTPState.NOTCONNECTED
	protected _secure = false
	protected loggedin = false

	protected sock: Socket | TLSSocket | null = null
	protected features: { [index: string]: string | boolean } | null = null
	protected monitor: SMTPResponseMonitor | null = null
	protected _domain = hostname()
	protected host = 'localhost'
	protected ssl: boolean | SMTPSocketOptions = false
	protected tls: boolean | SMTPSocketOptions = false
	protected port: number

	private activeTransport: SmtpTransport | null = null

	private get transport(): SmtpTransport | null {
		// Subclasses can replace sock directly instead of calling connect().
		if (this.sock !== (this.activeTransport?.socket ?? null))
			this.resetTransport(this.sock)
		return this.activeTransport
	}

	private resetTransport(socket: Socket | null) {
		// A new socket has none of its predecessor's capabilities, TLS status, or login status.
		this.features = null
		this._secure = false
		this.loggedin = !(this.user() && this.password())
		this.activeTransport = socket
			? new SmtpTransport(
					socket,
					(entry) => this.log(entry),
					(owner) => this.activeTransport === owner && this.sock === socket,
					(verb) => {
						this.features = verb === 'HELO' ? {} : null
					}
				)
			: null
	}

	constructor({
		timeout,
		host,
		user,
		password,
		domain,
		port,
		ssl,
		tls,
		logger,
		authentication,
	}: Partial<SMTPConnectionOptions> = {}) {
		super()

		if (Array.isArray(authentication)) {
			this.authentication = authentication
		}

		if (typeof timeout === 'number') {
			this.timeout = timeout
		}

		if (typeof domain === 'string') {
			this._domain = domain
		}

		if (typeof host === 'string') {
			this.host = host
		}

		if (
			ssl != null &&
			(typeof ssl === 'boolean' ||
				(typeof ssl === 'object' && Array.isArray(ssl) === false))
		) {
			this.ssl = ssl
		}

		if (
			tls != null &&
			(typeof tls === 'boolean' ||
				(typeof tls === 'object' && Array.isArray(tls) === false))
		) {
			this.tls = tls
		}

		this.port = port || (ssl ? SMTP_SSL_PORT : tls ? SMTP_TLS_PORT : SMTP_PORT)
		this.loggedin = user && password ? false : true

		if (!user && (password?.length ?? 0) > 0) {
			throw new Error('`password` cannot be set without `user`')
		}

		// keep these strings hidden when quicky debugging/logging
		this.user = () => user as string
		this.password = () => password as string

		if (typeof logger === 'function') {
			this.log = logger
		}
	}

	public debug(level: 0 | 1) {
		DEBUG = level
	}

	public state() {
		return this._state
	}

	public authorized() {
		const transport = this.transport
		return transport
			? transport.isAuthenticated || this.loggedin
			: !(this.user() && this.password())
	}

	public connect(
		callback: (err: Error | null | undefined, data?: unknown) => void,
		port: number = this.port,
		host: string = this.host,
		options: ConnectOptions = {}
	) {
		this.port = port
		this.host = host
		this.ssl = options.ssl || this.ssl

		if (this._state !== SMTPState.NOTCONNECTED) {
			this.quit(() => this.connect(callback, port, host, options))
		}

		const connected = () => {
			this.log(`connected: ${this.host}:${this.port}`)

			if (this.ssl && !this.tls) {
				// if key/ca/cert was passed in, check if connection is authorized
				if (
					typeof this.ssl !== 'boolean' &&
					this.sock instanceof TLSSocket &&
					!this.sock.authorized &&
					// oxlint-disable-next-line typescript/no-explicit-any
					(this.ssl as any).rejectUnauthorized !== false
				) {
					this.close(true)
					caller(
						callback,
						SMTPError.create(
							'could not establish an ssl connection',
							SMTPErrorStates.CONNECTIONAUTH
						)
					)
				} else {
					this._secure = true
				}
			}
		}

		const connectedErrBack = (err?: Error) => {
			if (!err) {
				connected()
			} else {
				this.close(true)
				this.log(err)
				caller(
					callback,
					SMTPError.create(
						'could not connect',
						SMTPErrorStates.COULDNOTCONNECT,
						err
					)
				)
			}
		}

		const response = (
			err: Error | null | undefined,
			data?: unknown,
			message?: string
		) => {
			if (err) {
				caller(callback, err)
			} else {
				const payload = data as { code: string; message: string; data: string }
				const msg = {
					code: payload?.code,
					data: payload?.data,
					message: payload?.message || message,
				}
				if (msg.code == '220') {
					this.log(msg.data)

					// might happen first, so no need to wait on connected()
					this._state = SMTPState.CONNECTED
					caller(callback, null, msg.data)
				} else {
					this.log(`response (data): ${msg.data}`)
					this.quit(() => {
						caller(
							callback,
							SMTPError.create(
								'bad response on connection',
								SMTPErrorStates.BADRESPONSE,
								err,
								msg.data
							)
						)
					})
				}
			}
		}

		this._state = SMTPState.CONNECTING
		this.log(`connecting: ${this.host}:${this.port}`)

		if (this.ssl) {
			this.sock = connect(
				this.port,
				this.host.trim(),
				typeof this.ssl === 'object' ? this.ssl : {},
				connected
			)
		} else {
			this.sock = new Socket()
			this.sock.connect(this.port, this.host.trim(), connectedErrBack)
		}

		this.resetTransport(this.sock)
		startSession(this, () => this.transport)
		this.watchSmtpReplies(this.sock)
		this.sock.once('response', response)
	}

	public send(
		str: string,
		callback: (err: Error | null | undefined, data?: unknown) => void
	) {
		if (this.transport && this._state === SMTPState.CONNECTED) {
			if (
				!this.transport.trySendRequest(str, (err, ...rest) =>
					caller(callback, err, ...rest)
				)
			)
				caller(
					callback,
					SMTPError.create(
						'SMTP connection is no longer writable',
						SMTPErrorStates.CONNECTIONCLOSED
					)
				)
		} else {
			this.close(true)
			caller(
				callback,
				SMTPError.create(
					'no connection has been established',
					SMTPErrorStates.NOCONNECTION
				)
			)
		}
	}

	public command(
		cmd: string,
		callback: (err: Error | null | undefined, data?: unknown) => void,
		codes: number[] | number = [250]
	) {
		return this.runCommand(cmd, callback, codes)
	}

	private runCommand(
		cmd: string,
		callback: CommandCallback,
		codes: number[] | number,
		sendRequest: SmtpRequestSender = (line, onReply) => this.send(line, onReply)
	) {
		const commandTransport = this.transport
		let greylistRetryUsed = false
		const codesArray = Array.isArray(codes)
			? codes
			: typeof codes === 'number'
				? [codes]
				: [250]

		const response = (
			err: Error | null | undefined,
			data?: unknown,
			message?: string
		) => {
			if (err) {
				caller(callback, err)
			} else {
				// data comes from SMTPResponseMonitor as { code, message, data }
				const payload = data as { code: string; message: string; data: string }
				const msg = {
					code: payload?.code,
					data: payload?.data,
					message: payload?.message || message,
				}
				const code = Number(msg.code)
				if (codesArray.indexOf(code) !== -1) {
					caller(callback, err, msg.data, msg.message)
				} else if (
					(code === 450 || code === 451) &&
					msg.message?.toLowerCase().includes('greylist') &&
					!greylistRetryUsed
				) {
					greylistRetryUsed = true
					const retry = () => {
						if (commandTransport !== this.transport)
							return caller(
								callback,
								SMTPError.create(
									'connection closed before greylist retry',
									SMTPErrorStates.CONNECTIONCLOSED
								)
							)
						sendRequest(cmd + CRLF, response)
					}
					if (commandTransport)
						commandTransport.retryAfter(GREYLIST_DELAY, retry)
					else setTimeout(retry, GREYLIST_DELAY)
				} else {
					const suffix = msg.message ? `: ${msg.message}` : ''
					const errorMessage = `bad response on command '${
						cmd.split(' ')[0]
					}'${suffix}`
					caller(
						callback,
						SMTPError.create(
							errorMessage,
							SMTPErrorStates.BADRESPONSE,
							null,
							msg.data
						)
					)
				}
			}
		}

		sendRequest(cmd + CRLF, response)
	}

	public helo(
		callback: (err: Error | null | undefined, data?: unknown) => void,
		domain?: string
	) {
		this.command(`helo ${domain || this._domain}`, this.heloReply(callback))
	}

	private heloReply(callback: CommandCallback): CommandCallback {
		const socket = this.sock
		return (err, data) => {
			if (socket !== this.sock && isRelayReply(err))
				return caller(
					callback,
					SMTPError.create(
						'connection closed during HELO',
						SMTPErrorStates.CONNECTIONCLOSED
					)
				)
			if (err) {
				caller(callback, err)
			} else {
				// HELO does not negotiate ESMTP extensions.
				this.features = {}
				caller(callback, err, data)
			}
		}
	}

	public starttls(
		callback: (err: Error | null | undefined, data?: unknown) => void
	) {
		const plaintextSocket = this.sock
		const onStartTlsReply: CallbackFn = (err, reply) => {
			if (!plaintextSocket || this.sock !== plaintextSocket) {
				return caller(
					callback,
					err ??
						SMTPError.create(
							'connection closed before STARTTLS handshake',
							SMTPErrorStates.CONNECTIONCLOSED
						)
				)
			}
			if (err) {
				this.close(true)
				return caller(callback, err)
			}

			const finishUpgrade = this.transport?.beginOperation()
			this.prepareForStartTlsHandshake(plaintextSocket)

			const onHandshake = (err: Error | null, tlsSocket: TLSSocket) => {
				if (this.sock !== tlsSocket) {
					return caller(
						callback,
						err ??
							SMTPError.create(
								'connection closed during STARTTLS handshake',
								SMTPErrorStates.CONNECTIONCLOSED
							)
					)
				}
				if (err) {
					this.close(true)
					return caller(callback, err)
				}

				this.resumeSmtpOverTls(tlsSocket)
				caller(callback, null, reply)
			}

			try {
				const tlsOptions = typeof this.tls === 'object' ? this.tls : {}
				this.sock = startTlsHandshake(
					plaintextSocket,
					this.host.trim(),
					tlsOptions,
					this.timeout,
					(err, tlsSocket) => {
						try {
							onHandshake(err, tlsSocket)
						} finally {
							finishUpgrade?.()
						}
					}
				)
			} catch (err) {
				try {
					this.close(true)
					caller(callback, err as Error)
				} finally {
					finishUpgrade?.()
				}
			}
		}
		this.command('starttls', onStartTlsReply, [220])
	}

	private prepareForStartTlsHandshake(plaintextSocket: Socket) {
		this.monitor?.stop()
		this.monitor = null
		plaintextSocket.setTimeout(0)
		this.features = null
		this._secure = false
		this._state = SMTPState.CONNECTING
	}

	private resumeSmtpOverTls(tlsSocket: TLSSocket) {
		if (this.activeTransport?.socket !== tlsSocket)
			this.resetTransport(tlsSocket)
		this.watchSmtpReplies(tlsSocket)
		this._secure = true
		this._state = SMTPState.CONNECTED
	}

	private watchSmtpReplies(socket: Socket) {
		this.monitor = new SMTPResponseMonitor(socket, this.timeout, () => {
			if (this.sock === socket) this.close(true)
		})
	}

	private needsStartTls() {
		return Boolean(this.tls) && !this._secure
	}

	public parse_smtp_features(data: string) {
		//  According to RFC1869 some (badly written)
		//  MTA's will disconnect on an ehlo. Toss an exception if
		//  that happens -ddm

		data.split('\n').forEach((ext) => {
			const parse = ext.match(/^(?:\d+[-=]?)\s*?([^\s]+)(?:\s+(.*)\s*?)?$/)

			// To be able to communicate with as many SMTP servers as possible,
			// we have to take the old-style auth advertisement into account, because:
			// 1) Else our SMTP feature parser gets confused.
			// 2) There are some servers that only advertise the auth methods we
			// support using the old style.

			if (parse != null && this.features != null) {
				// RFC 1869 requires a space between ehlo keyword and parameters.
				// It's actually stricter, in that only spaces are allowed between
				// parameters, but were not going to check for that here.  Note
				// that the space isn't present if there are no parameters.
				this.features[parse[1].toLowerCase()] = parse[2] || true
			}
		})
	}

	public ehlo(
		callback: (err: Error | null | undefined, data?: unknown) => void,
		domain?: string
	) {
		const socket = this.sock
		this.command(`ehlo ${domain || this._domain}`, (err, data) => {
			if (socket !== this.sock && isRelayReply(err)) {
				return caller(
					callback,
					SMTPError.create(
						'connection closed during EHLO',
						SMTPErrorStates.CONNECTIONCLOSED
					)
				)
			}
			if (err) {
				if (this.tls && socket && this.sock === socket) this.close(true)
				return caller(callback, err)
			}
			if (this.needsStartTls()) {
				return this.starttls((err) => {
					if (err) caller(callback, err)
					else this.ehlo(callback, domain)
				})
			}

			this.features = {}
			this.parse_smtp_features(data as string)
			caller(callback, null, data)
		})
	}

	public has_extn(opt: string) {
		return this.transport != null && this.features?.[opt.toLowerCase()] != null
	}

	public help(
		callback: (err: Error | null | undefined, data?: unknown) => void,
		domain: string
	) {
		this.command(domain ? `help ${domain}` : 'help', callback, [211, 214])
	}

	public rset(
		callback: (err: Error | null | undefined, data?: unknown) => void
	) {
		this.command('rset', callback)
	}

	public noop(
		callback: (err: Error | null | undefined, data?: unknown) => void
	) {
		this.send('noop' + CRLF, callback)
	}

	public mail(
		callback: (err: Error | null | undefined, data?: unknown) => void,
		from: string
	) {
		this.command(`mail FROM:${from}`, callback)
	}

	public rcpt(
		callback: (err: Error | null | undefined, data?: unknown) => void,
		to: string
	) {
		this.command(`RCPT TO:${to}`, callback, [250, 251])
	}

	/** @internal Bind the client's delivery to this socket before issuing DATA. */
	captureDataTransfer() {
		const socket = this.sock
		return new DataTransfer(this, () => this.sock === socket)
	}

	public data(
		callback: (err: Error | null | undefined, data?: unknown) => void
	) {
		this.command('data', callback, [354])
	}

	public data_end(
		callback: (err: Error | null | undefined, data?: unknown) => void
	) {
		this.command(`${CRLF}.`, callback)
	}

	public message(data: string) {
		const transport = this.transport
		if (transport) {
			transport.writeBody(data)
		} else {
			this.log(data)
			this.log('no socket to write to')
		}
	}

	public verify(
		address: string,
		callback: (err: Error | null | undefined, data?: unknown) => void
	) {
		this.command(`vrfy ${address}`, callback, [250, 251, 252])
	}

	public expn(
		address: string,
		callback: (err: Error | null | undefined, data?: unknown) => void
	) {
		this.command(`expn ${address}`, callback)
	}

	public ehlo_or_helo_if_needed(
		callback: (err: Error | null | undefined, data?: unknown) => void,
		domain?: string
	) {
		const domainName = domain || this._domain
		const transport = this.transport
		if (
			transport &&
			(this._state !== SMTPState.CONNECTED || !transport.allowsGreeting)
		)
			return caller(
				callback,
				SMTPError.create(
					'SMTP greeting not permitted during this exchange',
					SMTPErrorStates.ERROR
				)
			)
		if (transport && this.features && !this.needsStartTls())
			return caller(callback, null)
		this.ehlo((err, data) => {
			if (
				err &&
				transport &&
				this.transport === transport &&
				this._state === SMTPState.CONNECTED &&
				transport.allowsGreeting &&
				!this.tls
			) {
				return this.runCommand(
					`helo ${domainName}`,
					this.heloReply(callback),
					[250],
					(line, onReply) => {
						if (
							!transport.trySendRequest(line, onReply, { starting: 'greeting' })
						)
							onReply(err)
					}
				)
			}
			caller(callback, err, data)
		}, domainName)
	}

	// Capture the transport once; SASL continuations and retries share this sender.
	private createAuthLineSender(
		transport: SmtpTransport | null,
		interrupted: () => void
	): SmtpRequestSender {
		let firstAuthLineSent = false
		return (request, onReply) => {
			if (
				transport?.trySendRequest(request, onReply, {
					starting: firstAuthLineSent ? undefined : 'auth',
				})
			)
				firstAuthLineSent = true
			else interrupted()
		}
	}

	public login(
		callback: (err: Error | null | undefined, data?: unknown) => void,
		user?: string,
		password?: string,
		options: { method?: string; domain?: string } = {}
	) {
		const transport = this.transport
		if (
			transport &&
			(this._state !== SMTPState.CONNECTED || !transport.allowsLogin)
		)
			return caller(
				callback,
				SMTPError.create(
					'AUTH is not permitted in the current SMTP exchange',
					SMTPErrorStates.AUTHFAILED
				)
			)

		const credentials = {
			user: user ? () => user : this.user,
			password: password ? () => password : this.password,
		}

		const domain = options?.domain || this._domain

		const initiate = (err: Error | null | undefined, data?: unknown) => {
			if (err) {
				caller(callback, err)
				return
			}

			const method = selectAuthMethod(this.authentication, this.features?.auth)
			if (!method)
				return caller(
					callback,
					SMTPError.create(
						'no form of authorization supported',
						SMTPErrorStates.AUTHNOTSUPPORTED,
						null,
						data
					)
				)

			const authTransport = this.transport
			const reportAuthInterrupted = () =>
				caller(
					callback,
					SMTPError.create(
						'AUTH exchange interrupted',
						SMTPErrorStates.AUTHFAILED
					)
				)
			const sendAuthLine = this.createAuthLineSender(
				authTransport,
				reportAuthInterrupted
			)
			const failed = (err: Error) => {
				if (this.transport === authTransport) this.close()

				// AUTH commands and replies may contain credentials. Keep only the failure category.
				const sanitizedCause =
					err instanceof SMTPError && typeof err.code === 'number'
						? SMTPError.create('AUTH exchange failed', err.code)
						: null

				caller(
					callback,
					SMTPError.create(
						'authorization.failed',
						SMTPErrorStates.AUTHFAILED,
						sanitizedCause
					)
				)
			}

			authenticateWith(method, credentials, (line, onChallenge) => {
				this.runCommand(
					line,
					(err, reply, message?: string) => {
						if (err) return failed(err)
						if (this.transport !== authTransport) return reportAuthInterrupted()
						if (onChallenge) return onChallenge(message as string)
						this.loggedin = true
						caller(callback, err, reply, message)
					},
					onChallenge ? 334 : 235,
					sendAuthLine
				)
			})
		}

		this.ehlo_or_helo_if_needed(initiate, domain)
	}

	public close(force = false) {
		const closingSocket = this.sock
		const closingMonitor = this.monitor

		// Reset the session before a logger or close listener can reconnect.
		endSession(this)
		this.sock = null
		this.activeTransport = null
		this.monitor = null
		this._state = SMTPState.NOTCONNECTED
		this._secure = false
		this.features = null
		this.loggedin = !(this.user() && this.password())

		closingMonitor?.stop()
		if (closingSocket) {
			if (force) {
				closingSocket.destroy()
				this.log('smtp connection destroyed!')
			} else {
				closingSocket.end()
				this.log('smtp connection closed.')
			}
		}
		this.emit('close')
	}

	public quit(callback?: (...rest: unknown[]) => void) {
		this.command(
			'quit',
			(err, data) => {
				this.close()
				caller(callback, err, data)
			},
			[221, 250]
		)
	}
}
