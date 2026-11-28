const dataTerminator = '\r\n.\r\n'

// Only tracks wire facts needed to decide whether managed login may start.
// Public send()/command() still dispatch; this is not a command scheduler.
export class AuthAdmission {
	private phase: 'ready' | 'envelope' | 'body' | 'sasl' | 'tls' | 'unknown' =
		'ready'
	private authenticated = false

	// The first DATA byte starts a line, as if preceded by CRLF.
	private bodyTail = '\r\n'

	get isAuthenticated() {
		return this.authenticated
	}

	get allowsGreeting() {
		return this.phase === 'ready'
	}

	get allowsLogin() {
		return this.allowsGreeting && !this.authenticated
	}

	observeRequest(line: string) {
		if (this.phase === 'body') {
			// Only a tracked dot ending exactly one DATA block owns the final reply.
			const bytes = this.bodyTail + line
			const dot = bytes.indexOf(dataTerminator)
			if (
				requestVerb(line) !== '.' ||
				dot < 0 ||
				dot + dataTerminator.length !== bytes.length
			)
				this.phase = 'unknown'
			return
		}
		// One SASL response or one SMTP command per reply. Preserve raw writes,
		// but don't infer readiness from the first reply to multiple lines.
		if (!/^[^\r\n]*\r\n$/.test(line)) this.phase = 'unknown'
	}

	untrackedWrite(chunk: string) {
		if (this.phase !== 'body' || typeof chunk !== 'string') {
			this.phase = 'unknown'
			return
		}
		const bytes = this.bodyTail + chunk
		if (bytes.includes(dataTerminator)) this.phase = 'unknown'
		// A later chunk (or data_end) can complete a dot line begun here.
		this.bodyTail = bytes.slice(1 - dataTerminator.length)
	}
	overlap() {
		this.phase = 'unknown'
	}

	observeReply(verb: string, code: number) {
		if (this.phase === 'unknown' || this.phase === 'tls') return
		if (this.phase === 'body') {
			if (verb === '.' && (Math.trunc(code / 100) === 2 || code >= 400))
				this.phase = 'ready'
			return
		}
		if (verb === 'AUTH' || this.phase === 'sasl') {
			if (code === 235) this.authenticated = true
			if (code === 334)
				this.phase = this.phase === 'envelope' ? 'unknown' : 'sasl'
			else if (this.phase === 'sasl') this.phase = 'ready'
			return
		}
		if (!verb) this.phase = 'unknown'
		if (code >= 400) return
		switch (verb) {
			case 'MAIL':
				if (code === 250) this.phase = 'envelope'
				break
			case 'DATA':
				if (code === 354) {
					this.phase = 'body'
					this.bodyTail = '\r\n'
				}
				break
			case 'EHLO':
			case 'HELO':
				if (code === 250) {
					this.phase = 'ready'
					return verb
				}
				break
			case 'RSET':
				if (code === 250) this.phase = 'ready'
				break
			case 'STARTTLS':
				if (code === 220) this.phase = 'tls'
				break
			case 'NOOP':
			case 'HELP':
			case 'EXPN':
			case 'VRFY':
			case 'RCPT':
				break
			default:
				this.phase = 'unknown'
		}
	}
}

// Inspect only a single command. DATA's helper prefixes its dot with CRLF.
export function requestVerb(line: string) {
	if (line === dataTerminator || line === '.\r\n') return '.'
	return /^([a-z]+)(?: [^\r\n]*)?\r\n$/i.exec(line)?.[1].toUpperCase() ?? ''
}
