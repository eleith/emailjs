import { Socket } from 'net';
import { createHmac } from 'crypto';
import { hostname } from 'os';
import { connect, createSecureContext, TLSSocket } from 'tls';
import { EventEmitter } from 'events';
import type { Indexed } from '@ledge/types'; // eslint-disable-line no-unused-vars

import { SMTPResponse } from './response';
import { makeSMTPError, SMTPErrorStates } from './error';

/**
 * @readonly
 * @enum
 */
export const AUTH_METHODS = {
	PLAIN: 'PLAIN',
	'CRAM-MD5': 'CRAM-MD5',
	LOGIN: 'LOGIN',
	XOAUTH2: 'XOAUTH2',
} as const;

/**
 * @readonly
 * @enum
 */
export const SMTPState = {
	NOTCONNECTED: 0,
	CONNECTING: 1,
	CONNECTED: 2,
} as const;

export const DEFAULT_TIMEOUT = 5000 as const;

const SMTP_PORT = 25 as const;
const SMTP_SSL_PORT = 465 as const;
const SMTP_TLS_PORT = 587 as const;
const CRLF = '\r\n' as const;

let DEBUG: 0 | 1 = 0;

/**
 * @param {...any} args the message(s) to log
 * @returns {void}
 */
const log = (...args: any[]) => {
	if (DEBUG === 1) {
		args.forEach((d) =>
			console.log(
				typeof d === 'object'
					? d instanceof Error
						? d.message
						: JSON.stringify(d)
					: d
			)
		);
	}
};

/**
 * @param {function(...*): void} callback the function to call
 * @param {...*} args the arguments to apply to the function
 * @returns {void}
 */
const caller = (callback?: (...rest: any[]) => void, ...args: any[]) => {
	if (typeof callback === 'function') {
		callback.apply(null, args);
	}
};

export interface SMTPSocketOptions {
	key: string;
	ca: string;
	cert: string;
}

export interface SMTPConnectionOptions {
	timeout: number | null;
	user: string;
	password: string;
	domain: string;
	host: string;
	port: number;
	ssl: boolean | SMTPSocketOptions;
	tls: boolean | SMTPSocketOptions;
	authentication: (keyof typeof AUTH_METHODS)[];
	logger: (...args: any[]) => void;
}

export interface ConnectOptions {
	ssl?: boolean;
}

export class SMTPConnection extends EventEmitter {
	private _state: 0 | 1 | 2 = SMTPState.NOTCONNECTED;
	private _secure = false;

	protected sock: Socket | TLSSocket | null = null;
	protected features: Indexed<string | boolean> | null = null;
	protected monitor: SMTPResponse | null = null;
	protected authentication: (keyof typeof AUTH_METHODS)[];
	protected domain = hostname();
	protected host = 'localhost';
	protected ssl: boolean | SMTPSocketOptions = false;
	protected tls: boolean | SMTPSocketOptions = false;
	protected port: number;
	protected loggedin = false;
	protected log = log;

	public user: () => string;
	public password: () => string;
	public timeout: number = DEFAULT_TIMEOUT;

	/**
	 * SMTP class written using python's (2.7) smtplib.py as a base
	 */
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
		super();

		this.authentication = Array.isArray(authentication)
			? authentication
			: [
					AUTH_METHODS['CRAM-MD5'],
					AUTH_METHODS.LOGIN,
					AUTH_METHODS.PLAIN,
					AUTH_METHODS.XOAUTH2,
			  ];

		if (typeof timeout === 'number') {
			this.timeout = timeout;
		}

		if (typeof domain === 'string') {
			this.domain = domain;
		}

		if (typeof host === 'string') {
			this.host = host;
		}

		if (
			ssl != null &&
			(typeof ssl === 'boolean' ||
				(typeof ssl === 'object' && Array.isArray(ssl) === false))
		) {
			this.ssl = ssl;
		}

		if (
			tls != null &&
			(typeof tls === 'boolean' ||
				(typeof tls === 'object' && Array.isArray(tls) === false))
		) {
			this.tls = tls;
		}

		this.port = port || (ssl ? SMTP_SSL_PORT : tls ? SMTP_TLS_PORT : SMTP_PORT);
		this.loggedin = user && password ? false : true;

		// keep these strings hidden when quicky debugging/logging
		this.user = () => user as string;
		this.password = () => password as string;

		if (typeof logger === 'function') {
			this.log = log;
		}
	}

	/**
	 * @param {0 | 1} level -
	 * @returns {void}
	 */
	public debug(level: 0 | 1) {
		DEBUG = level;
	}

	/**
	 * @returns {SMTPState} the current state
	 */
	public state() {
		return this._state;
	}

	/**
	 * @returns {boolean} whether or not the instance is authorized
	 */
	public authorized() {
		return this.loggedin;
	}

	/**
	 * @param {function(...*): void} callback function to call after response
	 * @param {number} [port] the port to use for the connection
	 * @param {string} [host] the hostname to use for the connection
	 * @param {ConnectOptions} [options={}] the options
	 * @returns {void}
	 */
	connect(
		callback: (...rest: any[]) => void,
		port: number = this.port,
		host: string = this.host,
		options: ConnectOptions = {}
	) {
		this.port = port;
		this.host = host;
		this.ssl = options.ssl || this.ssl;

		if (this._state !== SMTPState.NOTCONNECTED) {
			this.quit(() => this.connect(callback, port, host, options));
		}

		/**
		 * @returns {void}
		 */
		const connected = () => {
			this.log(`connected: ${this.host}:${this.port}`);

			if (this.ssl && !this.tls) {
				// if key/ca/cert was passed in, check if connection is authorized
				if (
					typeof this.ssl !== 'boolean' &&
					this.sock instanceof TLSSocket &&
					!this.sock.authorized
				) {
					this.close(true);
					caller(
						callback,
						makeSMTPError(
							'could not establish an ssl connection',
							SMTPErrorStates.CONNECTIONAUTH
						)
					);
				} else {
					this._secure = true;
				}
			}
		};

		/**
		 * @param {Error} err err
		 * @returns {void}
		 */
		const connectedErrBack = (err?: Error) => {
			if (!err) {
				connected();
			} else {
				this.close(true);
				this.log(err);
				caller(
					callback,
					makeSMTPError(
						'could not connect',
						SMTPErrorStates.COULDNOTCONNECT,
						err
					)
				);
			}
		};

		const response = (
			err: Error | null | undefined,
			msg: { code: string | number; data: string }
		) => {
			if (err) {
				if (this._state === SMTPState.NOTCONNECTED && !this.sock) {
					return;
				}
				this.close(true);
				caller(callback, err);
			} else if (msg.code == '220') {
				this.log(msg.data);

				// might happen first, so no need to wait on connected()
				this._state = SMTPState.CONNECTED;
				caller(callback, null, msg.data);
			} else {
				this.log(`response (data): ${msg.data}`);
				this.quit(() => {
					caller(
						callback,
						makeSMTPError(
							'bad response on connection',
							SMTPErrorStates.BADRESPONSE,
							err,
							msg.data
						)
					);
				});
			}
		};

		this._state = SMTPState.CONNECTING;
		this.log(`connecting: ${this.host}:${this.port}`);

		if (this.ssl) {
			this.sock = connect(
				this.port,
				this.host,
				typeof this.ssl === 'object' ? this.ssl : {},
				connected
			);
		} else {
			this.sock = new Socket();
			this.sock.connect(this.port, this.host, connectedErrBack);
		}

		this.monitor = new SMTPResponse(this.sock, this.timeout, () =>
			this.close(true)
		);
		this.sock.once('response', response);
		this.sock.once('error', response); // the socket could reset or throw, so let's handle it and let the user know
	}

	/**
	 * @param {string} str the string to send
	 * @param {*} callback function to call after response
	 * @returns {void}
	 */
	send(str: string, callback: any) {
		if (this.sock && this._state === SMTPState.CONNECTED) {
			this.log(str);

			this.sock.once('response', (err, msg) => {
				if (err) {
					caller(callback, err);
				} else {
					this.log(msg.data);
					caller(callback, null, msg);
				}
			});
			this.sock.write(str);
		} else {
			this.close(true);
			caller(
				callback,
				makeSMTPError(
					'no connection has been established',
					SMTPErrorStates.NOCONNECTION
				)
			);
		}
	}

	/**
	 * @param {string} cmd command to issue
	 * @param {function(...*): void} callback function to call after response
	 * @param {(number[] | number)} [codes=[250]] array codes
	 * @returns {void}
	 */
	command(
		cmd: string,
		callback: (...rest: any[]) => void,
		codes: number[] | number = [250]
	) {
		const codesArray = Array.isArray(codes)
			? codes
			: typeof codes === 'number'
			? [codes]
			: [250];

		const response = (
			err: Error | null | undefined,
			msg: { code: string | number; data: string; message: string }
		) => {
			if (err) {
				caller(callback, err);
			} else {
				if (codesArray.indexOf(Number(msg.code)) !== -1) {
					caller(callback, err, msg.data, msg.message);
				} else {
					const suffix = msg.message ? `: ${msg.message}` : '';
					const errorMessage = `bad response on command '${
						cmd.split(' ')[0]
					}'${suffix}`;
					caller(
						callback,
						makeSMTPError(
							errorMessage,
							SMTPErrorStates.BADRESPONSE,
							null,
							msg.data
						)
					);
				}
			}
		};

		this.send(cmd + CRLF, response);
	}

	/**
	 * SMTP 'helo' command.
	 *
	 * Hostname to send for self command defaults to the FQDN of the local
	 * host.
	 *
	 * @param {function(...*): void} callback function to call after response
	 * @param {string} domain the domain to associate with the 'helo' request
	 * @returns {void}
	 */
	helo(callback: (...rest: any[]) => void, domain?: string) {
		this.command(`helo ${domain || this.domain}`, (err, data) => {
			if (err) {
				caller(callback, err);
			} else {
				this.parse_smtp_features(data);
				caller(callback, err, data);
			}
		});
	}

	/**
	 * @param {function(...*): void} callback function to call after response
	 * @returns {void}
	 */
	starttls(callback: (...rest: any[]) => void) {
		const response = (err: Error, msg: { data: any }) => {
			if (this.sock == null) {
				throw new Error('null socket');
			}

			if (err) {
				err.message += ' while establishing a starttls session';
				caller(callback, err);
			} else {
				const secureContext = createSecureContext(
					typeof this.tls === 'object' ? this.tls : {}
				);
				const secureSocket = new TLSSocket(this.sock, { secureContext });

				secureSocket.on('error', (err: Error) => {
					this.close(true);
					caller(callback, err);
				});

				this._secure = true;
				this.sock = secureSocket;

				new SMTPResponse(this.sock, this.timeout, () => this.close(true));
				caller(callback, msg.data);
			}
		};

		this.command('starttls', response, [220]);
	}

	/**
	 * @param {string} data the string to parse for features
	 * @returns {void}
	 */
	parse_smtp_features(data: string) {
		//  According to RFC1869 some (badly written)
		//  MTA's will disconnect on an ehlo. Toss an exception if
		//  that happens -ddm

		data.split('\n').forEach((ext) => {
			const parse = ext.match(/^(?:\d+[-=]?)\s*?([^\s]+)(?:\s+(.*)\s*?)?$/);

			// To be able to communicate with as many SMTP servers as possible,
			// we have to take the old-style auth advertisement into account,
			// because:
			// 1) Else our SMTP feature parser gets confused.
			// 2) There are some servers that only advertise the auth methods we
			// support using the old style.

			if (parse != null && this.features != null) {
				// RFC 1869 requires a space between ehlo keyword and parameters.
				// It's actually stricter, in that only spaces are allowed between
				// parameters, but were not going to check for that here.  Note
				// that the space isn't present if there are no parameters.
				this.features[parse[1].toLowerCase()] = parse[2] || true;
			}
		});
	}

	/**
	 * @param {function(...*): void} callback function to call after response
	 * @param {string} domain the domain to associate with the 'ehlo' request
	 * @returns {void}
	 */
	ehlo(callback: (...rest: any[]) => void, domain?: string) {
		this.features = {};
		this.command(`ehlo ${domain || this.domain}`, (err, data) => {
			if (err) {
				caller(callback, err);
			} else {
				this.parse_smtp_features(data);

				if (this.tls && !this._secure) {
					this.starttls(() => this.ehlo(callback, domain));
				} else {
					caller(callback, err, data);
				}
			}
		});
	}

	/**
	 * @param {string} opt the features keyname to check
	 * @returns {boolean} whether the extension exists
	 */
	has_extn(opt: string): boolean {
		return (this.features ?? {})[opt.toLowerCase()] === undefined;
	}

	/**
	 * SMTP 'help' command, returns text from the server
	 * @param {function(...*): void} callback function to call after response
	 * @param {string} domain the domain to associate with the 'help' request
	 * @returns {void}
	 */
	help(callback: (...rest: any[]) => void, domain: string) {
		this.command(domain ? `help ${domain}` : 'help', callback, [211, 214]);
	}

	/**
	 * @param {function(...*): void} callback function to call after response
	 * @returns {void}
	 */
	rset(callback: (...rest: any[]) => void) {
		this.command('rset', callback);
	}

	/**
	 * @param {function(...*): void} callback function to call after response
	 * @returns {void}
	 */
	noop(callback: (...rest: any[]) => void) {
		this.send('noop', callback);
	}

	/**
	 * @param {function(...*): void} callback function to call after response
	 * @param {string} from the sender
	 * @returns {void}
	 */
	mail(callback: (...rest: any[]) => void, from: string) {
		this.command(`mail FROM:${from}`, callback);
	}

	/**
	 * @param {function(...*): void} callback function to call after response
	 * @param {string} to the receiver
	 * @returns {void}
	 */
	rcpt(callback: (...rest: any[]) => void, to: string) {
		this.command(`RCPT TO:${to}`, callback, [250, 251]);
	}

	/**
	 * @param {function(...*): void} callback function to call after response
	 * @returns {void}
	 */
	data(callback: (...rest: any[]) => void) {
		this.command('data', callback, [354]);
	}

	/**
	 * @param {function(...*): void} callback function to call after response
	 * @returns {void}
	 */
	data_end(callback: (...rest: any[]) => void) {
		this.command(`${CRLF}.`, callback);
	}

	/**
	 * @param {string} data the message to send
	 * @returns {void}
	 */
	message(data: string) {
		this.log(data);
		this.sock?.write(data) ?? this.log('no socket to write to');
	}

	/**
	 * SMTP 'verify' command -- checks for address validity.
	 *
	 * @param {string} address the address to validate
	 * @param {function(...*): void} callback function to call after response
	 * @returns {void}
	 */
	verify(address: string, callback: (...rest: any[]) => void) {
		this.command(`vrfy ${address}`, callback, [250, 251, 252]);
	}

	/**
	 * SMTP 'expn' command -- expands a mailing list.
	 *
	 * @param {string} address the mailing list to expand
	 * @param {function(...*): void} callback function to call after response
	 * @returns {void}
	 */
	expn(address: string, callback: (...rest: any[]) => void) {
		this.command(`expn ${address}`, callback);
	}

	/**
	 * Calls this.ehlo() and, if an error occurs, this.helo().
	 *
	 * If there has been no previous EHLO or HELO command self session, self
	 * method tries ESMTP EHLO first.
	 *
	 * @param {function(...*): void} callback function to call after response
	 * @param {string} [domain] the domain to associate with the command
	 * @returns {void}
	 */
	ehlo_or_helo_if_needed(callback: (...rest: any[]) => void, domain?: string) {
		// is this code callable...?
		if (!this.features) {
			const response = (err: Error, data: any) => caller(callback, err, data);
			this.ehlo((err, data) => {
				if (err) {
					this.helo(response, domain);
				} else {
					caller(callback, err, data);
				}
			}, domain);
		}
	}

	/**
	 * Log in on an SMTP server that requires authentication.
	 *
	 * If there has been no previous EHLO or HELO command self session, self
	 * method tries ESMTP EHLO first.
	 *
	 * This method will return normally if the authentication was successful.
	 *
	 * @param {function(...*): void} callback function to call after response
	 * @param {string} [user] the username to authenticate with
	 * @param {string} [password] the password for the authentication
	 * @param {{ method: string, domain: string }} [options] login options
	 * @returns {void}
	 */
	login(
		callback: (...rest: any[]) => void,
		user?: string,
		password?: string,
		options: { method?: string; domain?: string } = {}
	) {
		const login = {
			user: user ? () => user : this.user,
			password: password ? () => password : this.password,
			method: options?.method?.toUpperCase() ?? '',
		};

		const domain = options?.domain || this.domain;

		const initiate = (err: Error | null | undefined, data: any) => {
			if (err) {
				caller(callback, err);
				return;
			}

			let method: keyof typeof AUTH_METHODS | null = null;

			/**
			 * @param {string} challenge challenge
			 * @returns {string} base64 cram hash
			 */
			const encode_cram_md5 = (challenge: string): string => {
				const hmac = createHmac('md5', login.password());
				hmac.update(Buffer.from(challenge, 'base64').toString('ascii'));
				return Buffer.from(`${login.user()} ${hmac.digest('hex')}`).toString(
					'base64'
				);
			};

			/**
			 * @returns {string} base64 login/password
			 */
			const encode_plain = (): string =>
				Buffer.from(`\u0000${login.user()}\u0000${login.password()}`).toString(
					'base64'
				);

			/**
			 * @see https://developers.google.com/gmail/xoauth2_protocol
			 * @returns {string} base64 xoauth2 auth token
			 */
			const encode_xoauth2 = (): string =>
				Buffer.from(
					`user=${login.user()}\u0001auth=Bearer ${login.password()}\u0001\u0001`
				).toString('base64');

			// List of authentication methods we support: from preferred to
			// less preferred methods.
			if (!method) {
				const preferred = this.authentication;
				let auth = '';

				if (typeof this.features?.auth === 'string') {
					auth = this.features.auth;
				}

				for (let i = 0; i < preferred.length; i++) {
					if (auth.includes(preferred[i])) {
						method = preferred[i];
						break;
					}
				}
			}

			/**
			 * handle bad responses from command differently
			 * @param {Error} err err
			 * @param {*} data data
			 * @returns {void}
			 */
			const failed = (err: Error, data: any) => {
				this.loggedin = false;
				this.close(); // if auth is bad, close the connection, it won't get better by itself
				caller(
					callback,
					makeSMTPError(
						'authorization.failed',
						SMTPErrorStates.AUTHFAILED,
						err,
						data
					)
				);
			};

			/**
			 * @param {Error} err err
			 * @param {*} data data
			 * @returns {void}
			 */
			const response = (err: Error | null | undefined, data: any) => {
				if (err) {
					failed(err, data);
				} else {
					this.loggedin = true;
					caller(callback, err, data);
				}
			};

			/**
			 * @param {Error} err err
			 * @param {*} data data
			 * @param {string} msg msg
			 * @returns {void}
			 */
			const attempt = (
				err: Error | null | undefined,
				data: any,
				msg: string
			) => {
				if (err) {
					failed(err, data);
				} else {
					if (method === AUTH_METHODS['CRAM-MD5']) {
						this.command(encode_cram_md5(msg), response, [235, 503]);
					} else if (method === AUTH_METHODS.LOGIN) {
						this.command(
							Buffer.from(login.password()).toString('base64'),
							response,
							[235, 503]
						);
					}
				}
			};

			/**
			 * @param {Error} err err
			 * @param {*} data data
			 * @param {string} msg msg
			 * @returns {void}
			 */
			const attempt_user = (err: Error, data: any) => {
				if (err) {
					failed(err, data);
				} else {
					if (method === AUTH_METHODS.LOGIN) {
						this.command(
							Buffer.from(login.user()).toString('base64'),
							attempt,
							[334]
						);
					}
				}
			};

			switch (method) {
				case AUTH_METHODS['CRAM-MD5']:
					this.command(`AUTH  ${AUTH_METHODS['CRAM-MD5']}`, attempt, [334]);
					break;
				case AUTH_METHODS.LOGIN:
					this.command(`AUTH ${AUTH_METHODS.LOGIN}`, attempt_user, [334]);
					break;
				case AUTH_METHODS.PLAIN:
					this.command(
						`AUTH ${AUTH_METHODS.PLAIN} ${encode_plain()}`,
						response,
						[235, 503]
					);
					break;
				case AUTH_METHODS.XOAUTH2:
					this.command(
						`AUTH ${AUTH_METHODS.XOAUTH2} ${encode_xoauth2()}`,
						response,
						[235, 503]
					);
					break;
				default:
					const msg = 'no form of authorization supported';
					const err = makeSMTPError(
						msg,
						SMTPErrorStates.AUTHNOTSUPPORTED,
						null,
						data
					);
					caller(callback, err);
					break;
			}
		};

		this.ehlo_or_helo_if_needed(initiate, domain);
	}

	/**
	 * @param {boolean} [force=false] whether or not to force destroy the connection
	 * @returns {void}
	 */
	close(force: boolean = false) {
		if (this.sock) {
			if (force) {
				this.log('smtp connection destroyed!');
				this.sock.destroy();
			} else {
				this.log('smtp connection closed.');
				this.sock.end();
			}
		}

		if (this.monitor) {
			this.monitor.stop();
			this.monitor = null;
		}

		this._state = SMTPState.NOTCONNECTED;
		this._secure = false;
		this.sock = null;
		this.features = null;
		this.loggedin = !(this.user() && this.password());
	}

	/**
	 * @param {function(...*): void} [callback] function to call after response
	 * @returns {void}
	 */
	quit(callback?: (...rest: any[]) => void) {
		this.command(
			'quit',
			(err, data) => {
				caller(callback, err, data);
				this.close();
			},
			[221, 250]
		);
	}
}
