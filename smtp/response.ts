import { makeSMTPError, SMTPErrorStates } from './error';

type Socket = import('net').Socket | import('tls').TLSSocket;
export class SMTPResponse {
	private buffer = '';
	public stop: (err?: Error) => void;

	constructor(
		private stream: Socket,
		timeout: number,
		onerror: (err: Error) => void
	) {
		const watch = (data: Parameters<SMTPResponse['watch']>[0]) =>
			this.watch(data);
		const end = () => this.end();
		const close = () => this.close();
		const error = (data: Parameters<SMTPResponse['error']>[0]) =>
			this.error(data);
		const timedout = (data: Parameters<SMTPResponse['timedout']>[0]) =>
			this.timedout(data);

		this.stream.on('data', watch);
		this.stream.on('end', end);
		this.stream.on('close', close);
		this.stream.on('error', error);
		this.stream.setTimeout(timeout, timedout);

		this.stop = (err) => {
			this.stream.removeAllListeners('response');
			this.stream.removeListener('data', watch);
			this.stream.removeListener('end', end);
			this.stream.removeListener('close', close);
			this.stream.removeListener('error', error);

			if (err != null && typeof onerror === 'function') {
				onerror(err);
			}
		};
	}

	public notify() {
		if (this.buffer.length) {
			// parse buffer for response codes
			const line = this.buffer.replace('\r', '');
			if (
				!line
					.trim()
					.split(/\n/)
					.pop()
					?.match(/^(\d{3})\s/) ??
				false
			) {
				return;
			}

			const match = line ? line.match(/(\d+)\s?(.*)/) : null;
			const data =
				match !== null
					? { code: match[1], message: match[2], data: line }
					: { code: -1, data: line };

			this.stream.emit('response', null, data);
			this.buffer = '';
		}
	}

	protected error(err: Error) {
		this.stream.emit(
			'response',
			makeSMTPError(
				'connection encountered an error',
				SMTPErrorStates.ERROR,
				err
			)
		);
	}

	protected watch(data: string | Buffer) {
		if (data !== null) {
			this.buffer += data.toString();
			this.notify();
		}
	}

	protected timedout(err: Error) {
		this.stream.end();
		this.stream.emit(
			'response',
			makeSMTPError(
				'timedout while connecting to smtp server',
				SMTPErrorStates.TIMEDOUT,
				err
			)
		);
	}

	protected close() {
		this.stream.emit(
			'response',
			makeSMTPError('connection has closed', SMTPErrorStates.CONNECTIONCLOSED)
		);
	}

	protected end() {
		this.stream.emit(
			'response',
			makeSMTPError('connection has ended', SMTPErrorStates.CONNECTIONENDED)
		);
	}
}
