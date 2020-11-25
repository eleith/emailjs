import { addressparser } from './address';
import { Message, MessageAttachment, MessageHeaders } from './message';
import { SMTPConnection, SMTPConnectionOptions, SMTPState } from './connection';

export interface MessageStack {
	callback: (error: Error | null, message: Message) => void;
	message: Message;
	attachment: MessageAttachment;
	text: string;
	returnPath: string;
	from: string;
	to: ReturnType<typeof addressparser>;
	cc: string[];
	bcc: string[];
}

export class SMTPClient {
	public readonly smtp: SMTPConnection;
	public readonly queue: MessageStack[] = [];

	protected sending = false;
	protected ready = false;
	protected timer: NodeJS.Timer | null = null;

	/**
	 * Create a standard SMTP client backed by a self-managed SMTP connection.
	 *
	 * NOTE: `host` is trimmed before being used to establish a connection; however, the original untrimmed value will still be visible in configuration.
	 *
	 * @param {SMTPConnectionOptions} server smtp options
	 */
	constructor(server: Partial<SMTPConnectionOptions>) {
		this.smtp = new SMTPConnection(server);
	}

	/**
	 * @public
	 * @param {Message} msg the message to send
	 * @param {function(err: Error, msg: Message): void} callback .
	 * @returns {void}
	 */
	public send(
		msg: Message,
		callback: (err: Error | null, msg: Message) => void
	) {
		const message: Message | null =
			msg instanceof Message
				? msg
				: this._canMakeMessage(msg)
				? new Message(msg)
				: null;

		if (message == null) {
			callback(new Error('message is not a valid Message instance'), msg);
			return;
		}

		message.valid((valid, why) => {
			if (valid) {
				const stack = this.createMessageStack(message, callback);
				if (stack.to.length === 0) {
					return callback(new Error('No recipients found in message'), msg);
				}
				this.queue.push(stack);
				this._poll();
			} else {
				callback(new Error(why), msg);
			}
		});
	}

	/**
	 * @public
	 * @param {Message} msg the message to send
	 * @returns {Promise<Message>} a promise that resolves to the fully processed message
	 */
	public sendAsync(msg: Message) {
		return new Promise<Message>((resolve, reject) => {
			this.send(msg, (err, msg) => {
				if (err != null) {
					reject(err);
				} else {
					resolve(msg);
				}
			});
		});
	}

	/**
	 * @public
	 * @description Converts a message to the raw object used by the internal stack.
	 * @param {Message} message message to convert
	 * @param {function(err: Error, msg: Message): void} callback errback
	 * @returns {MessageStack} raw message object
	 */
	public createMessageStack(
		message: Message,
		callback: (err: Error | null, msg: Message) => void = function () {
			/* ø */
		}
	) {
		const [{ address: from }] = addressparser(message.header.from);
		const stack = {
			message,
			to: [] as ReturnType<typeof addressparser>,
			from,
			callback: callback.bind(this),
		} as MessageStack;

		const {
			header: { to, cc, bcc, 'return-path': returnPath },
		} = message;

		if ((typeof to === 'string' || Array.isArray(to)) && to.length > 0) {
			stack.to = addressparser(to);
		}

		if ((typeof cc === 'string' || Array.isArray(cc)) && cc.length > 0) {
			stack.to = stack.to.concat(
				addressparser(cc).filter(
					(x) => stack.to.some((y) => y.address === x.address) === false
				)
			);
		}

		if ((typeof bcc === 'string' || Array.isArray(bcc)) && bcc.length > 0) {
			stack.to = stack.to.concat(
				addressparser(bcc).filter(
					(x) => stack.to.some((y) => y.address === x.address) === false
				)
			);
		}

		if (typeof returnPath === 'string' && returnPath.length > 0) {
			const parsedReturnPath = addressparser(returnPath);
			if (parsedReturnPath.length > 0) {
				const [{ address: returnPathAddress }] = parsedReturnPath;
				stack.returnPath = returnPathAddress as string;
			}
		}

		return stack;
	}

	/**
	 * @protected
	 * @returns {void}
	 */
	protected _poll() {
		if (this.timer != null) {
			clearTimeout(this.timer);
		}

		if (this.queue.length) {
			if (this.smtp.state() == SMTPState.NOTCONNECTED) {
				this._connect(this.queue[0]);
			} else if (
				this.smtp.state() == SMTPState.CONNECTED &&
				!this.sending &&
				this.ready
			) {
				this._sendmail(this.queue.shift() as MessageStack);
			}
		}
		// wait around 1 seconds in case something does come in,
		// otherwise close out SMTP connection if still open
		else if (this.smtp.state() == SMTPState.CONNECTED) {
			this.timer = setTimeout(() => this.smtp.quit(), 1000);
		}
	}

	/**
	 * @protected
	 * @param {MessageStack} stack stack
	 * @returns {void}
	 */
	protected _connect(stack: MessageStack) {
		/**
		 * @param {Error} err callback error
		 * @returns {void}
		 */
		const connect = (err: Error) => {
			if (!err) {
				const begin = (err: Error) => {
					if (!err) {
						this.ready = true;
						this._poll();
					} else {
						stack.callback(err, stack.message);

						// clear out the queue so all callbacks can be called with the same error message
						this.queue.shift();
						this._poll();
					}
				};

				if (!this.smtp.authorized()) {
					this.smtp.login(begin);
				} else {
					this.smtp.ehlo_or_helo_if_needed(begin);
				}
			} else {
				stack.callback(err, stack.message);

				// clear out the queue so all callbacks can be called with the same error message
				this.queue.shift();
				this._poll();
			}
		};

		this.ready = false;
		this.smtp.connect(connect);
	}

	/**
	 * @protected
	 * @param {MessageStack} msg message stack
	 * @returns {boolean} can make message
	 */
	protected _canMakeMessage(msg: MessageHeaders) {
		return (
			msg.from &&
			(msg.to || msg.cc || msg.bcc) &&
			(msg.text !== undefined || this._containsInlinedHtml(msg.attachment))
		);
	}

	/**
	 * @protected
	 * @param {MessageAttachment | MessageAttachment[]} attachment attachment
	 * @returns {boolean} whether the attachment contains inlined html
	 */
	protected _containsInlinedHtml(
		attachment: MessageAttachment | MessageAttachment[]
	) {
		if (Array.isArray(attachment)) {
			return attachment.some((att) => {
				return this._isAttachmentInlinedHtml(att);
			});
		} else {
			return this._isAttachmentInlinedHtml(attachment);
		}
	}

	/**
	 * @protected
	 * @param {MessageAttachment} attachment attachment
	 * @returns {boolean} whether the attachment is inlined html
	 */
	protected _isAttachmentInlinedHtml(attachment: MessageAttachment) {
		return (
			attachment &&
			(attachment.data || attachment.path) &&
			attachment.alternative === true
		);
	}

	/**
	 * @protected
	 * @param {MessageStack} stack stack
	 * @param {function(MessageStack): void} next next
	 * @returns {function(Error): void} callback
	 */
	protected _sendsmtp(stack: MessageStack, next: (msg: MessageStack) => void) {
		/**
		 * @param {Error} [err] error
		 * @returns {void}
		 */
		return (err: Error) => {
			if (!err && next) {
				next.apply(this, [stack]);
			} else {
				// if we snag on SMTP commands, call done, passing the error
				// but first reset SMTP state so queue can continue polling
				this.smtp.rset(() => this._senddone(err, stack));
			}
		};
	}

	/**
	 * @protected
	 * @param {MessageStack} stack stack
	 * @returns {void}
	 */
	protected _sendmail(stack: MessageStack) {
		const from = stack.returnPath || stack.from;
		this.sending = true;
		this.smtp.mail(this._sendsmtp(stack, this._sendrcpt), '<' + from + '>');
	}

	/**
	 * @protected
	 * @param {MessageStack} stack stack
	 * @returns {void}
	 */
	protected _sendrcpt(stack: MessageStack) {
		if (stack.to == null || typeof stack.to === 'string') {
			throw new TypeError('stack.to must be array');
		}

		const to = stack.to.shift()?.address;
		this.smtp.rcpt(
			this._sendsmtp(stack, stack.to.length ? this._sendrcpt : this._senddata),
			`<${to}>`
		);
	}

	/**
	 * @protected
	 * @param {MessageStack} stack stack
	 * @returns {void}
	 */
	protected _senddata(stack: MessageStack) {
		this.smtp.data(this._sendsmtp(stack, this._sendmessage));
	}

	/**
	 * @protected
	 * @param {MessageStack} stack stack
	 * @returns {void}
	 */
	protected _sendmessage(stack: MessageStack) {
		const stream = stack.message.stream();

		stream.on('data', (data) => this.smtp.message(data));
		stream.on('end', () => {
			this.smtp.data_end(
				this._sendsmtp(stack, () => this._senddone(null, stack))
			);
		});

		// there is no way to cancel a message while in the DATA portion,
		// so we have to close the socket to prevent a bad email from going out
		stream.on('error', (err) => {
			this.smtp.close();
			this._senddone(err, stack);
		});
	}

	/**
	 * @protected
	 * @param {Error} err err
	 * @param {MessageStack} stack stack
	 * @returns {void}
	 */
	protected _senddone(err: Error | null, stack: MessageStack) {
		this.sending = false;
		stack.callback(err, stack.message);
		this._poll();
	}
}
