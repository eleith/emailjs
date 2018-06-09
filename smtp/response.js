const SMTPError = require('./error');

class SMTPResponse {
	constructor(stream, timeout, onerror) {
		let buffer = '';

		const notify = () => {
			if (buffer.length) {
				// parse buffer for response codes
				const line = buffer.replace('\r', '');
				if (
					!line
						.trim()
						.split(/\n/)
						.pop()
						.match(/^(\d{3})\s/)
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

		const error = err => {
			stream.emit(
				'response',
				SMTPError('connection encountered an error', SMTPError.ERROR, err)
			);
		};

		const timedout = err => {
			stream.end();
			stream.emit(
				'response',
				SMTPError(
					'timedout while connecting to smtp server',
					SMTPError.TIMEDOUT,
					err
				)
			);
		};

		const watch = data => {
			if (data !== null) {
				buffer += data.toString();
				notify();
			}
		};

		const close = err => {
			stream.emit(
				'response',
				SMTPError('connection has closed', SMTPError.CONNECTIONCLOSED, err)
			);
		};

		const end = err => {
			stream.emit(
				'response',
				SMTPError('connection has ended', SMTPError.CONNECTIONENDED, err)
			);
		};

		this.stop = err => {
			stream.removeAllListeners('response');
			stream.removeListener('data', watch);
			stream.removeListener('end', end);
			stream.removeListener('close', close);
			stream.removeListener('error', error);

			if (err && typeof onerror === 'function') {
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

exports.monitor = (stream, timeout, onerror) =>
	new SMTPResponse(stream, timeout, onerror);
