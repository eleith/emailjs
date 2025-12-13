import { createHmac } from 'crypto'
import { EventEmitter } from 'events'
import { Socket } from 'net'
import { hostname } from 'os'
import { connect, createSecureContext, TLSSocket } from 'tls'
import type { ConnectionOptions } from 'tls'

import { SMTPError, SMTPErrorStates } from './error.js'
import { SMTPResponseMonitor } from './response.js'

export const AUTH_METHODS = {
	PLAIN: 'PLAIN',
	'CRAM-MD5': 'CRAM-MD5',
	LOGIN: 'LOGIN',
	XOAUTH2: 'XOAUTH2',
} as const

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
	protected domain = hostname()
	protected host = 'localhost'
	protected ssl: boolean | SMTPSocketOptions = false
	protected tls: boolean | SMTPSocketOptions = false
	protected port: number

	private greylistResponseTracker = new WeakSet<
		(err: Error | null | undefined, data?: unknown, message?: string) => void
	>()

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
			this.domain = domain
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
		return this.loggedin
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
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
				if (this._state === SMTPState.NOTCONNECTED && !this.sock) {
					return
				}
				this.close(true)
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

		this.monitor = new SMTPResponseMonitor(this.sock, this.timeout, () =>
			this.close(true)
		)
		this.sock.once('response', response)
		this.sock.once('error', response) // the socket could reset or throw, so let's handle it and let the user know
	}

	public send(
		str: string,
		callback: (err: Error | null | undefined, data?: unknown) => void
	) {
		if (this.sock != null && this._state === SMTPState.CONNECTED) {
			this.log(str)

			this.sock.once('response', (err, data, message) => {
				if (err) {
					caller(callback, err)
				} else {
					this.log(data)
					caller(callback, null, data, message)
				}
			})
			if (this.sock.writable) {
				this.sock.write(str)
			}
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
					this.greylistResponseTracker.has(response) === false
				) {
					this.greylistResponseTracker.add(response)
					setTimeout(() => {
						this.send(cmd + CRLF, response)
					}, GREYLIST_DELAY)
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

		this.greylistResponseTracker.delete(response)
		this.send(cmd + CRLF, response)
	}

	public helo(
		callback: (err: Error | null | undefined, data?: unknown) => void,
		domain?: string
	) {
		this.command(`helo ${domain || this.domain}`, (err, data) => {
			if (err) {
				caller(callback, err)
			} else {
				this.parse_smtp_features(data as string)
				caller(callback, err, data)
			}
		})
	}

	public starttls(
		callback: (err: Error | null | undefined, data?: unknown) => void
	) {
		const response = (
			err: Error | null | undefined,
			data?: unknown
		) => {
			if (this.sock == null) {
				throw new Error('null socket')
			}

			if (err) {
				err.message += ' while establishing a starttls session'
				caller(callback, err)
			} else {
				const secureContext = createSecureContext(
					typeof this.tls === 'object' ? this.tls : {}
				)
				const secureSocket = new TLSSocket(this.sock, { secureContext })

				secureSocket.on('error', (err: Error) => {
					this.close(true)
					caller(callback, err)
				})

				this._secure = true
				this.sock = secureSocket

				new SMTPResponseMonitor(this.sock, this.timeout, () => this.close(true))
				caller(callback, err, data)
			}
		}

		this.command('starttls', response, [220])
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
		this.features = {}
		this.command(`ehlo ${domain || this.domain}`, (err, data) => {
			if (err) {
				caller(callback, err)
			} else {
				this.parse_smtp_features(data as string)

				if (this.tls && !this._secure) {
					this.starttls(() => this.ehlo(callback, domain))
				} else {
					caller(callback, err, data)
				}
			}
		})
	}

	public has_extn(opt: string) {
		return (this.features ?? {})[opt.toLowerCase()] === undefined
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
		this.send('noop', callback)
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
		this.log(data)
		if (this.sock) {
			this.sock.write(data)
		} else {
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
		// is this code callable...?
		if (!this.features) {
			const response = (err: Error | null | undefined, data?: unknown) =>
				caller(callback, err, data)
			this.ehlo((err, data) => {
				if (err) {
					this.helo(response, domain)
				} else {
					caller(callback, err, data)
				}
			}, domain)
		}
	}

	public login(
		callback: (err: Error | null | undefined, data?: unknown) => void,
		user?: string,
		password?: string,
		options: { method?: string; domain?: string } = {}
	) {
		const login = {
			user: user ? () => user : this.user,
			password: password ? () => password : this.password,
			method: options?.method?.toUpperCase() ?? '',
		}

		const domain = options?.domain || this.domain

		const initiate = (err: Error | null | undefined, data?: unknown) => {
			if (err) {
				caller(callback, err)
				return
			}

			let method: keyof typeof AUTH_METHODS | null = null

			const encodeCramMd5 = (challenge: string) => {
				const hmac = createHmac('md5', login.password())
				hmac.update(Buffer.from(challenge, 'base64').toString('ascii'))
				return Buffer.from(`${login.user()} ${hmac.digest('hex')}`).toString(
					'base64'
				)
			}

			const encodePlain = () =>
				Buffer.from(`\u0000${login.user()}\u0000${login.password()}`).toString(
					'base64'
				)

			const encodeXoauth2 = () =>
				Buffer.from(
					`user=${login.user()}\u0001auth=Bearer ${login.password()}\u0001\u0001`
				).toString('base64')

			// List of authentication methods we support: from preferred to
			// less preferred methods.
			if (!method) {
				const preferred = this.authentication
				let auth = ''

				if (typeof this.features?.['auth'] === 'string') {
					auth = this.features['auth']
				}

				for (let i = 0; i < preferred.length; i++) {
					if (auth.includes(preferred[i])) {
						method = preferred[i]
						break
					}
				}
			}

			const failed = (err: Error, data?: unknown) => {
				this.loggedin = false
				this.close() // if auth is bad, close the connection, it won't get better by itself

				err.message = err.message.replace(login.password(), 'REDACTED')

				caller(
					callback,
					SMTPError.create(
						'authorization.failed',
						SMTPErrorStates.AUTHFAILED,
						err,
						data
					)
				)
			}

			const response = (
				err: Error | null | undefined,
				data?: unknown,
				message?: string
			) => {
				if (err) {
					failed(err as Error, data)
				} else {
					this.loggedin = true
					caller(callback, err, data, message)
				}
			}

			const attempt = (
				err: Error | null | undefined,
				data?: unknown,
				msg?: string
			) => {
				if (err) {
					failed(err as Error, data)
				} else {
					if (method === AUTH_METHODS['CRAM-MD5']) {
						this.command(encodeCramMd5(msg as string), response, [235, 503])
					} else if (method === AUTH_METHODS.LOGIN) {
						this.command(
							Buffer.from(login.password()).toString('base64'),
							response,
							[235, 503]
						)
					}
				}
			}

			const attemptUser = (err: Error | null | undefined, data?: unknown) => {
				if (err) {
					failed(err, data)
				} else {
					if (method === AUTH_METHODS.LOGIN) {
						this.command(
							Buffer.from(login.user()).toString('base64'),
							attempt,
							[334]
						)
					}
				}
			}

			switch (method) {
				case AUTH_METHODS['CRAM-MD5']:
					this.command(`AUTH  ${AUTH_METHODS['CRAM-MD5']}`, attempt, [334])
					break
				case AUTH_METHODS.LOGIN:
					this.command(`AUTH ${AUTH_METHODS.LOGIN}`, attemptUser, [334])
					break
				case AUTH_METHODS.PLAIN:
					this.command(
						`AUTH ${AUTH_METHODS.PLAIN} ${encodePlain()}`,
						response,
						[235, 503]
					)
					break
				case AUTH_METHODS.XOAUTH2:
					this.command(
						`AUTH ${AUTH_METHODS.XOAUTH2} ${encodeXoauth2()}`,
						response,
						[235, 503]
					)
					break
				default:
					caller(
						callback,
						SMTPError.create(
							'no form of authorization supported',
							SMTPErrorStates.AUTHNOTSUPPORTED,
							null,
							data
						)
					)
					break
			}
		}

		this.ehlo_or_helo_if_needed(initiate, domain)
	}

	public close(force = false) {
		if (this.sock) {
			if (force) {
				this.log('smtp connection destroyed!')
				this.sock.destroy()
			} else {
				this.log('smtp connection closed.')
				this.sock.end()
			}
		}

		if (this.monitor) {
			this.monitor.stop()
			this.monitor = null
		}

		this._state = SMTPState.NOTCONNECTED
		this._secure = false
		this.sock = null
		this.features = null
		this.loggedin = !(this.user() && this.password())
	}

	public quit(callback?: (...rest: unknown[]) => void) {
		this.command(
			'quit',
			(err, data) => {
				caller(callback, err, data)
				this.close()
			},
			[221, 250]
		)
	}
}
