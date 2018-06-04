/*
 * SMTP class written using python's (2.7) smtplib.py as a base
 */
const net = require('net');
const crypto = require('crypto');
const os = require('os');
const tls = require('tls');
const { EventEmitter } = require('events');

const SMTPResponse = require('./response');
const SMTPError = require('./error');

const SMTP_PORT = 25;
const SMTP_SSL_PORT = 465;
const SMTP_TLS_PORT = 587;
const CRLF = '\r\n';
const AUTH_METHODS = {
	PLAIN: 'PLAIN',
	CRAM_MD5: 'CRAM-MD5',
	LOGIN: 'LOGIN',
	XOAUTH2: 'XOAUTH2',
};

const TIMEOUT = 5000;
let DEBUG = 0;

const log = function() {
	if (DEBUG) {
		Array.prototype.slice.call(arguments).forEach(function(d) {
			console.log(d);
		});
	}
};

const caller = function(callback) {
	if (typeof callback == 'function') {
		const args = Array.prototype.slice.call(arguments);
		args.shift();

		callback.apply(null, args);
	}
};

const SMTPState = {
	NOTCONNECTED: 0,
	CONNECTING: 1,
	CONNECTED: 2,
};

class SMTP extends EventEmitter {
	constructor(options = {}) {
		super();

		const {
			timeout,
			user,
			password,
			domain,
			host,
			port,
			ssl,
			tls,
			authentication,
		} = Object.assign(
			{
				timeout: TIMEOUT,
				domain: os.hostname(),
				host: 'localhost',
				ssl: false,
				tls: false,
				authentication: [
					AUTH_METHODS.CRAM_MD5,
					AUTH_METHODS.LOGIN,
					AUTH_METHODS.PLAIN,
					AUTH_METHODS.XOAUTH2,
				],
			},
			options
		);

		this._state = SMTPState.NOTCONNECTED;
		this._secure = false;

		this.sock = null;
		this.features = null;
		this.monitor = null;

		this.authentication = authentication;
		this.timeout = timeout;
		this.domain = domain;
		this.host = host;
		this.ssl = ssl;
		this.tls = tls;

		this.port = port || (ssl ? SMTP_SSL_PORT : tls ? SMTP_TLS_PORT : SMTP_PORT);
		this.loggedin = user && password ? false : true;

		// keep these strings hidden when quicky debugging/logging
		this.user = () => options.user;
		this.password = () => options.password;
	}

	debug(level) {
		DEBUG = level;
	}

	state() {
		return this._state;
	}

	authorized() {
		return this.loggedin;
	}

	connect(callback, port, host, options) {
		options = options || {};

		this.host = host || this.host;
		this.port = port || this.port;
		this.ssl = options.ssl || this.ssl;

		if (this._state != SMTPState.NOTCONNECTED) {
			this.quit(() =>
				this.connect(
					callback,
					port,
					host,
					options
				)
			);
			return;
		}

		const connected = err => {
			if (!err) {
				log(`connected: ${this.host}:${this.port}`);

				if (this.ssl && !this.tls) {
					// if key/ca/cert was passed in, check if connection is authorized
					if (typeof this.ssl != 'boolean' && !this.sock.authorized) {
						this.close(true);
						const msg = 'could not establish an ssl connection';
						caller(callback, SMTPError(msg, SMTPError.CONNECTIONAUTH, err));
					} else {
						this._secure = true;
					}
				}
			} else {
				this.close(true);
				caller(
					callback,
					SMTPError('could not connect', SMTPError.COULDNOTCONNECT, err)
				);
			}
		};

		const response = (err, msg) => {
			if (err) {
				if (this._state === SMTPState.NOTCONNECTED && !this.sock) {
					return;
				}
				this.close(true);
				caller(callback, err);
			} else if (msg.code == '220') {
				log(msg.data);

				// might happen first, so no need to wait on connected()
				this._state = SMTPState.CONNECTED;
				caller(callback, null, msg.data);
			} else {
				log(`response (data): ${msg.data}`);
				this.quit(() => {
					const err = SMTPError(
						'bad response on connection',
						SMTPError.BADRESPONSE,
						err,
						msg.data
					);
					caller(callback, err);
				});
			}
		};

		this._state = SMTPState.CONNECTING;
		log(`connecting: ${this.host}:${this.port}`);

		if (this.ssl) {
			this.sock = tls.connect(
				this.port,
				this.host,
				this.ssl,
				connected
			);
		} else {
			this.sock = new net.Socket();
			this.sock.connect(
				this.port,
				this.host,
				connected
			);
		}

		this.monitor = SMTPResponse.monitor(this.sock, this.timeout, () =>
			this.close(true)
		);
		this.sock.once('response', response);
		this.sock.once('error', response); // the socket could reset or throw, so let's handle it and let the user know
	}

	send(str, callback) {
		if (this.sock && this._state == SMTPState.CONNECTED) {
			log(str);

			this.sock.once('response', (err, msg) => {
				if (err) {
					caller(callback, err);
				} else {
					log(msg.data);
					caller(callback, null, msg);
				}
			});
			this.sock.write(str);
		} else {
			this.close(true);
			caller(
				callback,
				SMTPError('no connection has been established', SMTPError.NOCONNECTION)
			);
		}
	}

	command(cmd, callback, codes, failed) {
		codes = Array.isArray(codes)
			? codes
			: typeof codes == 'number'
				? [codes]
				: [250];

		const response = (err, msg) => {
			if (err) {
				caller(callback, err);
			} else {
				if (codes.indexOf(Number(msg.code)) != -1) {
					caller(callback, err, msg.data, msg.message);
				} else {
					const suffix = msg.message ? `: ${msg.message}` : '';
					const errorMessage = `bad response on command '${
						cmd.split(' ')[0]
					}'${suffix}`;
					caller(
						callback,
						SMTPError(errorMessage, SMTPError.BADRESPONSE, null, msg.data)
					);
				}
			}
		};

		this.send(cmd + CRLF, response);
	}

	helo(callback, domain) {
		/*
     * SMTP 'helo' command.
     * Hostname to send for self command defaults to the FQDN of the local
     * host.
     */
		this.command(`helo ${domain || this.domain}`, (err, data) => {
			if (err) {
				caller(callback, err);
			} else {
				this.parse_smtp_features(data);
				caller(callback, err, data);
			}
		});
	}

	starttls(callback) {
		const response = (err, msg) => {
			if (err) {
				err.message += ' while establishing a starttls session';
				caller(callback, err);
			} else {
				// support new API
				if (tls.TLSSocket) {
					const secured_socket = new tls.TLSSocket(this.sock, {
						secureContext: tls.createSecureContext
							? tls.createSecureContext(this.tls)
							: crypto.createCredentials(this.tls),
						isServer: false, // older versions of node (0.12), do not default to false properly...
					});

					secured_socket.on('error', err => {
						this.close(true);
						caller(callback, err);
					});

					this._secure = true;
					this.sock = secured_socket;

					SMTPResponse.monitor(this.sock, this.timeout, () => this.close(true));
					caller(callback, msg.data);
				} else {
					let secured_socket = null;
					const secured = () => {
						this._secure = true;
						this.sock = secured_socket;

						SMTPResponse.monitor(this.sock, this.timeout, () =>
							this.close(true)
						);
						caller(callback, msg.data);
					};

					const starttls = require('starttls');
					secured_socket = starttls(
						{
							socket: this.sock,
							host: this.host,
							port: this.port,
							pair: tls.createSecurePair(
								tls.createSecureContext
									? tls.createSecureContext(this.tls)
									: crypto.createCredentials(this.tls),
								false
							),
						},
						secured
					).cleartext;

					secured_socket.on('error', err => {
						this.close(true);
						caller(callback, err);
					});
				}
			}
		};

		this.command('starttls', response, [220]);
	}

	parse_smtp_features(data) {
		//  According to RFC1869 some (badly written)
		//  MTA's will disconnect on an ehlo. Toss an exception if
		//  that happens -ddm

		data.split('\n').forEach(ext => {
			const parse = ext.match(/^(?:\d+[-=]?)\s*?([^\s]+)(?:\s+(.*)\s*?)?$/);

			// To be able to communicate with as many SMTP servers as possible,
			// we have to take the old-style auth advertisement into account,
			// because:
			// 1) Else our SMTP feature parser gets confused.
			// 2) There are some servers that only advertise the auth methods we
			// support using the old style.

			if (parse) {
				// RFC 1869 requires a space between ehlo keyword and parameters.
				// It's actually stricter, in that only spaces are allowed between
				// parameters, but were not going to check for that here.  Note
				// that the space isn't present if there are no parameters.
				this.features[parse[1].toLowerCase()] = parse[2] || true;
			}
		});

		return;
	}

	ehlo(callback, domain) {
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

	has_extn(opt) {
		return this.features[opt.toLowerCase()] === undefined;
	}

	help(callback, args) {
		// SMTP 'help' command, returns text from the server
		this.command(args ? `help ${args}` : 'help', callback, [211, 214]);
	}

	rset(callback) {
		this.command('rset', callback);
	}

	noop(callback) {
		this.send('noop', callback);
	}

	mail(callback, from) {
		this.command(`mail FROM:${from}`, callback);
	}

	rcpt(callback, to) {
		this.command(`RCPT TO:${to}`, callback, [250, 251]);
	}

	data(callback) {
		this.command('data', callback, [354]);
	}

	data_end(callback) {
		this.command(`${CRLF}.`, callback);
	}

	message(data) {
		log(data);
		this.sock.write(data);
	}

	verify(address, callback) {
		// SMTP 'verify' command -- checks for address validity.
		this.command(`vrfy ${address}`, callback, [250, 251, 252]);
	}

	expn(address, callback) {
		// SMTP 'expn' command -- expands a mailing list.
		this.command(`expn ${address}`, callback);
	}

	ehlo_or_helo_if_needed(callback, domain) {
		// Call this.ehlo() and/or this.helo() if needed.
		// If there has been no previous EHLO or HELO command self session, self
		//  method tries ESMTP EHLO first.
		if (!this.features) {
			const response = (err, data) => caller(callback, err, data);
			this.ehlo((err, data) => {
				if (err) {
					this.helo(response, domain);
				} else {
					caller(callback, err, data);
				}
			}, domain);
		}
	}

	login(callback, user, password, options) {
		const login = {
			user: user ? () => user : this.user,
			password: password ? () => password : this.password,
			method: options && options.method ? options.method.toUpperCase() : '',
		};

		const domain = options && options.domain ? options.domain : this.domain;

		const initiate = (err, data) => {
			if (err) {
				caller(callback, err);
				return;
			}

			/*
				* Log in on an SMTP server that requires authentication.
				*
				* The arguments are:
				*     - user:     The user name to authenticate with.
				*     - password: The password for the authentication.
				*
				* If there has been no previous EHLO or HELO command self session, self
				* method tries ESMTP EHLO first.
				*
				* This method will return normally if the authentication was successful.
				*/

			let method = null;

			const encode_cram_md5 = challenge => {
				const hmac = crypto.createHmac('md5', login.password());
				hmac.update(Buffer.from(challenge, 'base64').toString('ascii'));
				return Buffer.from(`${login.user()} ${hmac.digest('hex')}`).toString(
					'base64'
				);
			};

			const encode_plain = () =>
				Buffer.from(`\u0000${login.user()}\u0000${login.password()}`).toString(
					'base64'
				);

			// see: https://developers.google.com/gmail/xoauth2_protocol
			const encode_xoauth2 = () =>
				Buffer.from(
					`user=${login.user()}\u0001auth=Bearer ${login.password()}\u0001\u0001`
				).toString('base64');

			// List of authentication methods we support: from preferred to
			// less preferred methods.
			if (!method) {
				const preferred = this.authentication;
				let auth = '';

				if (this.features && this.features.auth) {
					if (typeof this.features.auth === 'string') {
						auth = this.features.auth;
					}
				}

				for (let i = 0; i < preferred.length; i++) {
					if (auth.includes(preferred[i])) {
						method = preferred[i];
						break;
					}
				}
			}

			// handle bad responses from command differently
			const failed = (err, data) => {
				this.loggedin = false;
				this.close(); // if auth is bad, close the connection, it won't get better by itself
				caller(
					callback,
					SMTPError('authorization.failed', SMTPError.AUTHFAILED, err, data)
				);
			};

			const response = (err, data) => {
				if (err) {
					failed(err, data);
				} else {
					this.loggedin = true;
					caller(callback, err, data);
				}
			};

			const attempt = (err, data, msg) => {
				if (err) {
					failed(err, data);
				} else {
					if (method == AUTH_METHODS.CRAM_MD5) {
						this.command(encode_cram_md5(msg), response, [235, 503]);
					} else if (method == AUTH_METHODS.LOGIN) {
						this.command(
							Buffer.from(login.password()).toString('base64'),
							response,
							[235, 503]
						);
					}
				}
			};

			const attempt_user = (err, data, msg) => {
				if (err) {
					failed(err, data);
				} else {
					if (method == AUTH_METHODS.LOGIN) {
						this.command(
							Buffer.from(login.user()).toString('base64'),
							attempt,
							[334]
						);
					}
				}
			};

			switch (method) {
				case AUTH_METHODS.CRAM_MD5:
					this.command(`AUTH  ${AUTH_METHODS.CRAM_MD5}`, attempt, [334]);
					break;
				case AUTH_METHODS.LOGIN:
					this.command(`AUTH ${AUTH_METHODS.LOGIN}`, attempt_user, [334]);
					break;
				case AUTH_METHODS.PLAIN:
					this.command(
						`AUTH ${AUTH_METHODS.PLAIN} ${encode_plain(
							login.user(),
							login.password()
						)}`,
						response,
						[235, 503]
					);
					break;
				case AUTH_METHODS.XOAUTH2:
					this.command(
						`AUTH ${AUTH_METHODS.XOAUTH2} ${encode_xoauth2(
							login.user(),
							login.password()
						)}`,
						response,
						[235, 503]
					);
					break;
				default:
					const msg = 'no form of authorization supported';
					const err = SMTPError(msg, SMTPError.AUTHNOTSUPPORTED, null, data);
					caller(callback, err);
					break;
			}
		};

		this.ehlo_or_helo_if_needed(initiate, domain);
	}

	close(force) {
		if (this.sock) {
			if (force) {
				log('smtp connection destroyed!');
				this.sock.destroy();
			} else {
				log('smtp connection closed.');
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

	quit(callback) {
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

exports.SMTP = SMTP;
exports.state = SMTPState;
exports.authentication = AUTH_METHODS;
