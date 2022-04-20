import type { PathLike } from 'fs';
import {
	existsSync,
	open as openFile,
	close as closeFile,
	closeSync as closeFileSync,
	read as readFile,
} from 'fs';
import { hostname } from 'os';
import { Stream } from 'stream';
import type { Readable } from 'stream';

import { addressparser } from './address.js';
import { getRFC2822Date } from './date.js';
import { mimeWordEncode } from './mime.js';

const CRLF = '\r\n' as const;

/**
 * MIME standard wants 76 char chunks when sending out.
 */
export const MIMECHUNK = 76 as const;

/**
 * meets both base64 and mime divisibility
 */
export const MIME64CHUNK = (MIMECHUNK * 6) as 456;

/**
 * size of the message stream buffer
 */
export const BUFFERSIZE = (MIMECHUNK * 24 * 7) as 12768;

export interface MessageAttachmentHeaders {
	[index: string]: string | undefined;
	'content-type'?: string;
	'content-transfer-encoding'?: BufferEncoding | '7bit' | '8bit';
	'content-disposition'?: string;
}

export interface MessageAttachment {
	[index: string]:
		| string
		| boolean
		| MessageAttachment
		| MessageAttachment[]
		| MessageAttachmentHeaders
		| Readable
		| PathLike
		| undefined;
	name?: string;
	headers?: MessageAttachmentHeaders;
	inline?: boolean;
	alternative?: MessageAttachment | boolean;
	related?: MessageAttachment[];
	data?: string;
	encoded?: boolean;
	stream?: Readable;
	path?: PathLike;
	type?: string;
	charset?: string;
	method?: string;
}

export interface MessageHeaders {
	[index: string]:
		| boolean
		| string
		| string[]
		| null
		| undefined
		| MessageAttachment
		| MessageAttachment[];
	'content-type'?: string;
	'message-id'?: string;
	'return-path'?: string | null;
	date?: string;
	from: string | string[];
	to: string | string[];
	cc?: string | string[];
	bcc?: string | string[];
	subject: string;
	text: string | null;
	attachment?: MessageAttachment | MessageAttachment[];
}

let counter = 0;

function generateBoundary() {
	let text = '';
	const possible =
		"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'()+_,-./:=?";

	for (let i = 0; i < 69; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}

	return text;
}

function convertPersonToAddress(person: string | string[]) {
	return addressparser(person)
		.map(({ name, address }) => {
			return name
				? `${mimeWordEncode(name).replace(/,/g, '=2C')} <${address}>`
				: address;
		})
		.join(', ');
}

function convertDashDelimitedTextToSnakeCase(text: string) {
	return text
		.toLowerCase()
		.replace(/^(.)|-(.)/g, (match) => match.toUpperCase());
}

export class Message {
	public readonly attachments: MessageAttachment[] = [];
	public readonly header: Partial<MessageHeaders> = {
		'message-id': `<${new Date().getTime()}.${counter++}.${
			process.pid
		}@${hostname()}>`,
		date: getRFC2822Date(),
	};
	public readonly content: string = 'text/plain; charset=utf-8';
	public readonly text?: string;
	public alternative: MessageAttachment | null = null;

	/**
	 * Construct an rfc2822-compliant message object.
	 *
	 * Special notes:
	 * - The `from` field is required.
	 * - At least one `to`, `cc`, or `bcc` header is also required.
	 * - You can also add whatever other headers you want.
	 *
	 * @see https://tools.ietf.org/html/rfc2822
	 * @param {Partial<MessageHeaders>} headers Message headers
	 */
	constructor(headers: Partial<MessageHeaders>) {
		for (const header in headers) {
			// allow user to override default content-type to override charset or send a single non-text message
			if (/^content-type$/i.test(header)) {
				this.content = headers[header] as string;
			} else if (header === 'text') {
				this.text = headers[header] as string;
			} else if (
				header === 'attachment' &&
				typeof headers[header] === 'object'
			) {
				const attachment = headers[header];
				if (Array.isArray(attachment)) {
					for (let i = 0; i < attachment.length; i++) {
						this.attach(attachment[i]);
					}
				} else if (attachment != null) {
					this.attach(attachment);
				}
			} else if (header === 'subject') {
				this.header.subject = mimeWordEncode(headers.subject as string);
			} else if (/^(cc|bcc|to|from)/i.test(header)) {
				this.header[header.toLowerCase()] = convertPersonToAddress(
					headers[header] as string | string[]
				);
			} else {
				// allow any headers the user wants to set??
				this.header[header.toLowerCase()] = headers[header];
			}
		}
	}

	/**
	 * Attach a file to the message.
	 *
	 * Can be called multiple times, each adding a new attachment.
	 *
	 * @public
	 * @param {MessageAttachment} options attachment options
	 * @returns {Message} the current instance for chaining
	 */
	public attach(options: MessageAttachment) {
		// sender can specify an attachment as an alternative
		if (options.alternative) {
			this.alternative = options;
			this.alternative.charset = options.charset || 'utf-8';
			this.alternative.type = options.type || 'text/html';
			this.alternative.inline = true;
		} else {
			this.attachments.push(options);
		}

		return this;
	}

	/**
	 * @public
	 * @returns {{ isValid: boolean, validationError: (string | undefined) }} an object specifying whether this message is validly formatted, and the first validation error if it is not.
	 */
	public checkValidity() {
		if (
			typeof this.header.from !== 'string' &&
			Array.isArray(this.header.from) === false
		) {
			return {
				isValid: false,
				validationError: 'Message must have a `from` header',
			};
		}

		if (
			typeof this.header.to !== 'string' &&
			Array.isArray(this.header.to) === false &&
			typeof this.header.cc !== 'string' &&
			Array.isArray(this.header.cc) === false &&
			typeof this.header.bcc !== 'string' &&
			Array.isArray(this.header.bcc) === false
		) {
			return {
				isValid: false,
				validationError:
					'Message must have at least one `to`, `cc`, or `bcc` header',
			};
		}

		if (this.attachments.length > 0) {
			const failed: string[] = [];

			this.attachments.forEach((attachment) => {
				if (attachment.path) {
					if (existsSync(attachment.path) === false) {
						failed.push(`${attachment.path} does not exist`);
					}
				} else if (attachment.stream) {
					if (!attachment.stream.readable) {
						failed.push('attachment stream is not readable');
					}
				} else if (!attachment.data) {
					failed.push('attachment has no data associated with it');
				}
			});
			return {
				isValid: failed.length === 0,
				validationError: failed.join(', '),
			};
		}

		return { isValid: true, validationError: undefined };
	}

	/**
	 * @public
	 * @deprecated does not conform to the `errback` style followed by the rest of the library, and will be removed in the next major version. use `checkValidity` instead.
	 * @param {function(isValid: boolean, invalidReason: (string | undefined)): void} callback .
	 * @returns {void}
	 */
	public valid(callback: (isValid: boolean, invalidReason?: string) => void) {
		const { isValid, validationError } = this.checkValidity();
		callback(isValid, validationError);
	}

	/**
	 * @public
	 * @returns {MessageStream} a stream of the current message
	 */
	public stream() {
		return new MessageStream(this);
	}

	/**
	 * @public
	 * @param {function(Error, string): void} callback the function to call with the error and buffer
	 * @returns {void}
	 */
	public read(callback: (err: Error, buffer: string) => void) {
		let buffer = '';
		const str = this.stream();
		str.on('data', (data) => (buffer += data));
		str.on('end', (err) => callback(err, buffer));
		str.on('error', (err) => callback(err, buffer));
	}

	public readAsync() {
		return new Promise<string>((resolve, reject) => {
			this.read((err, buffer) => {
				if (err != null) {
					reject(err);
				} else {
					resolve(buffer);
				}
			});
		});
	}
}

class MessageStream extends Stream {
	readable = true;
	paused = false;
	buffer: Buffer | null = Buffer.alloc(MIMECHUNK * 24 * 7);
	bufferIndex = 0;

	/**
	 * @param {Message} message the message to stream
	 */
	constructor(private message: Message) {
		super();

		/**
		 * @param {string} [data] the data to output
		 * @param {Function} [callback] the function
		 * @param {any[]} [args] array of arguments to pass to the callback
		 * @returns {void}
		 */
		const output = (data: string) => {
			// can we buffer the data?
			if (this.buffer != null) {
				const bytes = Buffer.byteLength(data);

				if (bytes + this.bufferIndex < this.buffer.length) {
					this.buffer.write(data, this.bufferIndex);
					this.bufferIndex += bytes;
				}
				// we can't buffer the data, so ship it out!
				else if (bytes > this.buffer.length) {
					if (this.bufferIndex) {
						this.emit(
							'data',
							this.buffer.toString('utf-8', 0, this.bufferIndex)
						);
						this.bufferIndex = 0;
					}

					const loops = Math.ceil(data.length / this.buffer.length);
					let loop = 0;
					while (loop < loops) {
						this.emit(
							'data',
							data.substring(
								this.buffer.length * loop,
								this.buffer.length * (loop + 1)
							)
						);
						loop++;
					}
				} // we need to clean out the buffer, it is getting full
				else {
					if (!this.paused) {
						this.emit(
							'data',
							this.buffer.toString('utf-8', 0, this.bufferIndex)
						);
						this.buffer.write(data, 0);
						this.bufferIndex = bytes;
					} else {
						// we can't empty out the buffer, so let's wait till we resume before adding to it
						this.once('resume', () => output(data));
					}
				}
			}
		};

		/**
		 * @param {MessageAttachment} [attachment] the attachment whose headers you would like to output
		 * @returns {void}
		 */
		const outputAttachmentHeaders = (attachment: MessageAttachment) => {
			let data: string[] = [];
			const headers: Partial<MessageHeaders> = {
				'content-type':
					attachment.type +
					(attachment.charset ? `; charset=${attachment.charset}` : '') +
					(attachment.method ? `; method=${attachment.method}` : ''),
				'content-transfer-encoding': 'base64',
				'content-disposition': attachment.inline
					? 'inline'
					: `attachment; filename="${mimeWordEncode(
							attachment.name as string
					  )}"`,
			};

			// allow sender to override default headers
			if (attachment.headers != null) {
				for (const header in attachment.headers) {
					headers[header.toLowerCase()] = attachment.headers[header];
				}
			}

			for (const header in headers) {
				data = data.concat([
					convertDashDelimitedTextToSnakeCase(header),
					': ',
					headers[header] as string,
					CRLF,
				]);
			}

			output(data.concat([CRLF]).join(''));
		};

		/**
		 * @param {string} data the data to output as base64
		 * @param {function(): void} [callback] the function to call after output is finished
		 * @returns {void}
		 */
		const outputBase64 = (data: string, callback?: () => void) => {
			const loops = Math.ceil(data.length / MIMECHUNK);
			let loop = 0;
			while (loop < loops) {
				output(data.substring(MIMECHUNK * loop, MIMECHUNK * (loop + 1)) + CRLF);
				loop++;
			}
			if (callback) {
				callback();
			}
		};

		const outputFile = (
			attachment: MessageAttachment,
			next: (err: NodeJS.ErrnoException | null) => void
		) => {
			const chunk = MIME64CHUNK * 16;
			const buffer = Buffer.alloc(chunk);

			const inputEncoding =
				attachment?.headers?.['content-transfer-encoding'] || 'base64';
			const encoding =
				inputEncoding === '7bit'
					? 'ascii'
					: inputEncoding === '8bit'
					? 'binary'
					: inputEncoding;

			/**
			 * @param {Error} err the error to emit
			 * @param {number} fd the file descriptor
			 * @returns {void}
			 */
			const opened = (err: NodeJS.ErrnoException | null, fd: number) => {
				if (err) {
					this.emit('error', err);
					return;
				}
				const readBytes = (
					err: NodeJS.ErrnoException | null,
					bytes: number
				) => {
					if (err || this.readable === false) {
						this.emit(
							'error',
							err || new Error('message stream was interrupted somehow!')
						);
						return;
					}
					// guaranteed to be encoded without padding unless it is our last read
					outputBase64(buffer.toString(encoding, 0, bytes), () => {
						if (bytes == chunk) {
							// we read a full chunk, there might be more
							readFile(fd, buffer, 0, chunk, null, readBytes);
						} // that was the last chunk, we are done reading the file
						else {
							this.removeListener('error', closeFileSync);
							closeFile(fd, next);
						}
					});
				};
				readFile(fd, buffer, 0, chunk, null, readBytes);
				this.once('error', closeFileSync);
			};

			openFile(attachment.path as PathLike, 'r', opened);
		};

		/**
		 * @param {MessageAttachment} attachment the metadata to use as headers
		 * @param {function(): void} callback the function to call after output is finished
		 * @returns {void}
		 */
		const outputStream = (
			attachment: MessageAttachment,
			callback: () => void
		) => {
			const { stream } = attachment;
			if (stream?.readable) {
				let previous = Buffer.alloc(0);

				stream.resume();

				stream.on('end', () => {
					outputBase64(previous.toString('base64'), callback);
					this.removeListener('pause', stream.pause);
					this.removeListener('resume', stream.resume);
					this.removeListener('error', stream.resume);
				});

				stream.on('data', (buff) => {
					// do we have bytes from a previous stream data event?
					let buffer = Buffer.isBuffer(buff) ? buff : Buffer.from(buff);

					if (previous.byteLength > 0) {
						buffer = Buffer.concat([previous, buffer]);
					}

					const padded = buffer.length % MIME64CHUNK;
					previous = Buffer.alloc(padded);

					// encode as much of the buffer to base64 without empty bytes
					if (padded > 0) {
						// copy dangling bytes into previous buffer
						buffer.copy(previous, 0, buffer.length - padded);
					}
					outputBase64(buffer.toString('base64', 0, buffer.length - padded));
				});

				this.on('pause', stream.pause);
				this.on('resume', stream.resume);
				this.on('error', stream.resume);
			} else {
				this.emit('error', { message: 'stream not readable' });
			}
		};

		const outputAttachment = (
			attachment: MessageAttachment,
			callback: () => void
		) => {
			const build = attachment.path
				? outputFile
				: attachment.stream
				? outputStream
				: outputData;
			outputAttachmentHeaders(attachment);
			build(attachment, callback);
		};

		/**
		 * @param {string} boundary the boundary text between outputs
		 * @param {MessageAttachment[]} list the list of potential messages to output
		 * @param {number} index the index of the list item to output
		 * @param {function(): void} callback the function to call if index is greater than upper bound
		 * @returns {void}
		 */
		const outputMessage = (
			boundary: string,
			list: MessageAttachment[],
			index: number,
			callback: () => void
		) => {
			if (index < list.length) {
				output(`--${boundary}${CRLF}`);
				if (list[index].related) {
					outputRelated(list[index], () =>
						outputMessage(boundary, list, index + 1, callback)
					);
				} else {
					outputAttachment(list[index], () =>
						outputMessage(boundary, list, index + 1, callback)
					);
				}
			} else {
				output(`${CRLF}--${boundary}--${CRLF}${CRLF}`);
				callback();
			}
		};

		const outputMixed = () => {
			const boundary = generateBoundary();
			output(
				`Content-Type: multipart/mixed; boundary="${boundary}"${CRLF}${CRLF}--${boundary}${CRLF}`
			);

			if (this.message.alternative == null) {
				outputText(this.message);
				outputMessage(boundary, this.message.attachments, 0, close);
			} else {
				outputAlternative(
					// typescript bug; should narrow to { alternative: MessageAttachment }
					this.message as Parameters<typeof outputAlternative>[0],
					() => outputMessage(boundary, this.message.attachments, 0, close)
				);
			}
		};

		/**
		 * @param {MessageAttachment} attachment the metadata to use as headers
		 * @param {function(): void} callback the function to call after output is finished
		 * @returns {void}
		 */
		const outputData = (
			attachment: MessageAttachment,
			callback: () => void
		) => {
			outputBase64(
				attachment.encoded
					? attachment.data ?? ''
					: Buffer.from(attachment.data ?? '').toString('base64'),
				callback
			);
		};

		/**
		 * @param {Message} message the message to output
		 * @returns {void}
		 */
		const outputText = (message: Message) => {
			let data: string[] = [];

			data = data.concat([
				'Content-Type:',
				message.content,
				CRLF,
				'Content-Transfer-Encoding: 7bit',
				CRLF,
			]);
			data = data.concat(['Content-Disposition: inline', CRLF, CRLF]);
			data = data.concat([message.text || '', CRLF, CRLF]);

			output(data.join(''));
		};

		/**
		 * @param {MessageAttachment} message the message to output
		 * @param {function(): void} callback the function to call after output is finished
		 * @returns {void}
		 */
		const outputRelated = (
			message: MessageAttachment,
			callback: () => void
		) => {
			const boundary = generateBoundary();
			output(
				`Content-Type: multipart/related; boundary="${boundary}"${CRLF}${CRLF}--${boundary}${CRLF}`
			);
			outputAttachment(message, () => {
				outputMessage(boundary, message.related ?? [], 0, () => {
					output(`${CRLF}--${boundary}--${CRLF}${CRLF}`);
					callback();
				});
			});
		};

		/**
		 * @param {Message} message the message to output
		 * @param {function(): void} callback the function to call after output is finished
		 * @returns {void}
		 */
		const outputAlternative = (
			message: Message & { alternative: MessageAttachment },
			callback: () => void
		) => {
			const boundary = generateBoundary();
			output(
				`Content-Type: multipart/alternative; boundary="${boundary}"${CRLF}${CRLF}--${boundary}${CRLF}`
			);
			outputText(message);
			output(`--${boundary}${CRLF}`);

			/**
			 * @returns {void}
			 */
			const finish = () => {
				output([CRLF, '--', boundary, '--', CRLF, CRLF].join(''));
				callback();
			};

			if (message.alternative.related) {
				outputRelated(message.alternative, finish);
			} else {
				outputAttachment(message.alternative, finish);
			}
		};

		const close = (err?: Error) => {
			if (err) {
				this.emit('error', err);
			} else {
				this.emit(
					'data',
					this.buffer?.toString('utf-8', 0, this.bufferIndex) ?? ''
				);
				this.emit('end');
			}
			this.buffer = null;
			this.bufferIndex = 0;
			this.readable = false;
			this.removeAllListeners('resume');
			this.removeAllListeners('pause');
			this.removeAllListeners('error');
			this.removeAllListeners('data');
			this.removeAllListeners('end');
		};

		/**
		 * @returns {void}
		 */
		const outputHeaderData = () => {
			if (this.message.attachments.length || this.message.alternative) {
				output(`MIME-Version: 1.0${CRLF}`);
				outputMixed();
			} // you only have a text message!
			else {
				outputText(this.message);
				close();
			}
		};

		/**
		 * @returns {void}
		 */
		const outputHeader = () => {
			let data: string[] = [];

			for (const header in this.message.header) {
				// do not output BCC in the headers (regex) nor custom Object.prototype functions...
				if (
					!/bcc/i.test(header) &&
					Object.prototype.hasOwnProperty.call(this.message.header, header)
				) {
					data = data.concat([
						convertDashDelimitedTextToSnakeCase(header),
						': ',
						this.message.header[header] as string,
						CRLF,
					]);
				}
			}

			output(data.join(''));
			outputHeaderData();
		};

		this.once('destroy', close);
		process.nextTick(outputHeader);
	}

	/**
	 * @public
	 * pause the stream
	 * @returns {void}
	 */
	public pause() {
		this.paused = true;
		this.emit('pause');
	}

	/**
	 * @public
	 * resume the stream
	 * @returns {void}
	 */
	public resume() {
		this.paused = false;
		this.emit('resume');
	}

	/**
	 * @public
	 * destroy the stream
	 * @returns {void}
	 */
	public destroy() {
		this.emit(
			'destroy',
			this.bufferIndex > 0 ? { message: 'message stream destroyed' } : null
		);
	}

	/**
	 * @public
	 * destroy the stream at first opportunity
	 * @returns {void}
	 */
	public destroySoon() {
		this.emit('destroy');
	}
}
