const smtp = require('./smtp');
const message = require('./message');
const addressparser = require('addressparser');

class Client {
	constructor(server) {
		this.smtp = new smtp.SMTP(server);
		//this.smtp.debug(1);

		this.queue = [];
		this.timer = null;
		this.sending = false;
		this.ready = false;
	}

	_poll() {
		clearTimeout(this.timer);

		if (this.queue.length) {
			if (this.smtp.state() == smtp.state.NOTCONNECTED) {
				this._connect(this.queue[0]);
			} else if (
				this.smtp.state() == smtp.state.CONNECTED &&
				!this.sending &&
				this.ready
			) {
				this._sendmail(this.queue.shift());
			}
		}
		// wait around 1 seconds in case something does come in,
		// otherwise close out SMTP connection if still open
		else if (this.smtp.state() == smtp.state.CONNECTED) {
			this.timer = setTimeout(() => this.smtp.quit(), 1000);
		}
	}

	_connect(stack) {
		const connect = err => {
			if (!err) {
				const begin = err => {
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

	send(msg, callback) {
		if (
			!(msg instanceof message.Message) &&
			msg.from &&
			(msg.to || msg.cc || msg.bcc) &&
			(msg.text !== undefined || this._containsInlinedHtml(msg.attachment))
		) {
			msg = message.create(msg);
		}

		if (msg instanceof message.Message) {
			msg.valid((valid, why) => {
				if (valid) {
					const stack = {
						message: msg,
						to: addressparser(msg.header.to),
						from: addressparser(msg.header.from)[0].address,
						callback: (callback || function() {}).bind(this),
					};

					if (msg.header.cc) {
						stack.to = stack.to.concat(addressparser(msg.header.cc));
					}

					if (msg.header.bcc) {
						stack.to = stack.to.concat(addressparser(msg.header.bcc));
					}

					if (
						msg.header['return-path'] &&
						addressparser(msg.header['return-path']).length
					) {
						stack.returnPath = addressparser(
							msg.header['return-path']
						)[0].address;
					}

					this.queue.push(stack);
					this._poll();
				} else {
					callback(new Error(why), msg);
				}
			});
		} else {
			callback(new Error('message is not a valid Message instance'), msg);
		}
	}

	_containsInlinedHtml(attachment) {
		if (Array.isArray(attachment)) {
			return attachment.some(() => {
				return att => {
					return this._isAttachmentInlinedHtml(att);
				};
			});
		} else {
			return this._isAttachmentInlinedHtml(attachment);
		}
	}

	_isAttachmentInlinedHtml(attachment) {
		return (
			attachment &&
			(attachment.data || attachment.path) &&
			attachment.alternative === true
		);
	}

	_sendsmtp(stack, next) {
		return err => {
			if (!err && next) {
				next.apply(this, [stack]);
			} else {
				// if we snag on SMTP commands, call done, passing the error
				// but first reset SMTP state so queue can continue polling
				this.smtp.rset(() => this._senddone(err, stack));
			}
		};
	}

	_sendmail(stack) {
		const from = stack.returnPath || stack.from;
		this.sending = true;
		this.smtp.mail(this._sendsmtp(stack, this._sendrcpt), '<' + from + '>');
	}

	_sendrcpt(stack) {
		const to = stack.to.shift().address;
		this.smtp.rcpt(
			this._sendsmtp(stack, stack.to.length ? this._sendrcpt : this._senddata),
			'<' + to + '>'
		);
	}

	_senddata(stack) {
		this.smtp.data(this._sendsmtp(stack, this._sendmessage));
	}

	_sendmessage(stack) {
		const stream = stack.message.stream();

		stream.on('data', data => this.smtp.message(data));
		stream.on('end', () => {
			this.smtp.data_end(
				this._sendsmtp(stack, () => this._senddone(null, stack))
			);
		});

		// there is no way to cancel a message while in the DATA portion,
		// so we have to close the socket to prevent a bad email from going out
		stream.on('error', err => {
			this.smtp.close();
			this._senddone(err, stack);
		});
	}

	_senddone(err, stack) {
		this.sending = false;
		stack.callback(err, stack.message);
		this._poll();
	}
}

exports.Client = Client;
exports.connect = server => new Client(server);
