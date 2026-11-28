import { createHmac } from 'crypto'

export const AUTH_METHODS = {
	PLAIN: 'PLAIN',
	'CRAM-MD5': 'CRAM-MD5',
	LOGIN: 'LOGIN',
	XOAUTH2: 'XOAUTH2',
} as const

type AuthMethod = keyof typeof AUTH_METHODS

export function selectAuthMethod(
	preferred: AuthMethod[],
	advertised: string | boolean | undefined
) {
	if (typeof advertised !== 'string') return undefined
	const method = preferred.find((candidate) => advertised.includes(candidate))
	// JavaScript callers can supply a preference we don't implement.
	return method && Object.hasOwn(AUTH_METHODS, method) ? method : undefined
}

const base64 = (value: string) => Buffer.from(value).toString('base64')

// A line with a continuation expects a 334 challenge. The last line expects 235.
export function authenticateWith(
	method: AuthMethod,
	credentials: { user(): string; password(): string },
	send: (line: string, onChallenge?: (challenge: string) => void) => void
) {
	switch (method) {
		case 'LOGIN':
			return send('AUTH LOGIN', () => {
				send(base64(credentials.user()), () =>
					send(base64(credentials.password()))
				)
			})
		case 'CRAM-MD5':
			return send('AUTH  CRAM-MD5', (challenge) => {
				const digest = createHmac('md5', credentials.password())
					.update(Buffer.from(challenge, 'base64').toString('ascii'))
					.digest('hex')
				send(base64(`${credentials.user()} ${digest}`))
			})
		case 'PLAIN': {
			const payload = `\u0000${credentials.user()}\u0000${credentials.password()}`
			return send(`AUTH PLAIN ${base64(payload)}`)
		}
		case 'XOAUTH2': {
			const payload = `user=${credentials.user()}\u0001auth=Bearer ${credentials.password()}\u0001\u0001`
			return send(`AUTH XOAUTH2 ${base64(payload)}`)
		}
	}
}
