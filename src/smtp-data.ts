import type { SMTPConnection } from './connection.js'
import { SMTPError, SMTPErrorStates } from './error.js'

type Result = (err?: Error | null) => void
interface DataBody {
	write(chunk: string): void
	end(): void
	abort(err: Error): void
}

export class DataTransfer {
	constructor(
		private readonly smtp: SMTPConnection,
		private readonly stillAttached: () => boolean
	) {}

	private disconnected() {
		return SMTPError.create(
			'connection closed during DATA transfer',
			SMTPErrorStates.CONNECTIONCLOSED
		)
	}

	private untilClose(done: Result, start: (finish: Result) => void) {
		let finished = false
		const finish: Result = (err) => {
			if (finished) return
			finished = true
			this.smtp.off('close', onClose)
			done(err)
		}
		const onClose = () => {
			// A final reply may already be in its logger. Let it settle first.
			if (!this.stillAttached())
				queueMicrotask(() => finish(this.disconnected()))
		}
		this.smtp.on('close', onClose)
		if (this.stillAttached()) start(finish)
		else finish(this.disconnected())
	}

	// DATA and its terminator determine the delivery result. RSET is only
	// cleanup: whether it replies or the socket closes, report the original error.
	private runDataCommand(send: (reply: Result) => void, done: Result) {
		this.untilClose((err) => {
			if (!err || !this.stillAttached()) return done(err)
			this.untilClose(
				() => done(err),
				(reply) => this.smtp.rset(reply)
			)
		}, send)
	}

	open(done: Result) {
		this.runDataCommand(
			(reply) => this.smtp.data(reply),
			(err) => done(err || (this.stillAttached() ? null : this.disconnected()))
		)
	}

	stream(produce: (body: DataBody) => void, done: Result) {
		let acceptingChunks = true
		this.untilClose(
			(err) => {
				acceptingChunks = false
				if (err) return done(err)
				this.runDataCommand((reply) => this.smtp.data_end(reply), done)
			},
			(finish) =>
				produce({
					write: (chunk) => {
						if (!acceptingChunks) return
						if (this.stillAttached()) this.smtp.message(chunk)
						else finish(this.disconnected())
					},
					end: () => {
						if (acceptingChunks) finish(null)
					},
					abort: (err) => {
						if (!acceptingChunks) return
						acceptingChunks = false
						if (this.stillAttached()) this.smtp.close()
						finish(err)
					},
				})
		)
	}
}
