import { SMTPError, SMTPErrorStates } from './error.js';
import type { Socket } from 'net';
import type { TLSSocket } from 'tls';

export class SMTPResponseMonitor {
	public readonly stop: (err?: Error) => void;

	constructor(
		stream: Socket | TLSSocket,
		timeout: number,
		onerror: (err: Error) => void
	) {
		let buffer = '';

		const notify = () => {
			if (buffer.length) {
				// parse buffer for response codes
				const line = buffer.replace('\r', '');
				if (
					!(
						line
							.trim()
							.split(/\n/)
							.pop()
							?.match(/^(\d{3})\s/) ?? false
					)
				) {
					return;
				}

				const match = line ? line.match(/(\d+)\s?(.*)/) : null;
				const data =
					match !== null
						? { code: match[1], message: match[2], data: line }
						: { code: -1, data: line };

				stream.emit('response', null, data);
				buffer = '';
			}
		};

		const error = (err: Error) => {
			stream.emit(
				'response',
				SMTPError.create(
					'connection encountered an error',
					SMTPErrorStates.ERROR,
					err
				)
			);
		};

		const timedout = (err?: Error) => {
			stream.end();
			stream.emit(
				'response',
				SMTPError.create(
					'timedout while connecting to smtp server',
					SMTPErrorStates.TIMEDOUT,
					err
				)
			);
		};

		const watch = (data: string | Buffer) => {
			if (data !== null) {
				buffer += data.toString();
				notify();
			}
		};

		const close = (err: Error) => {
			stream.emit(
				'response',
				SMTPError.create(
					'connection has closed',
					SMTPErrorStates.CONNECTIONCLOSED,
					err
				)
			);
		};

		const end = (err: Error) => {
			stream.emit(
				'response',
				SMTPError.create(
					'connection has ended',
					SMTPErrorStates.CONNECTIONENDED,
					err
				)
			);
		};

		this.stop = (err) => {
			stream.removeAllListeners('response');
			stream.removeListener('data', watch);
			stream.removeListener('end', end);
			stream.removeListener('close', close);
			stream.removeListener('error', error);

			if (err != null && typeof onerror === 'function') {
				onerror(err);
			}
		};

		stream.on('data', watch);
		stream.on('end', end);
		stream.on('close', close);
		stream.on('error', error);
		stream.setTimeout(timeout, timedout);
	}
}
