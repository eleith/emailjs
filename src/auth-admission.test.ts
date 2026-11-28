import { expect, it } from 'vitest'
import { AuthAdmission, requestVerb } from './auth-admission.js'

function exchange(auth: AuthAdmission, request: string, code: number) {
	auth.observeRequest(request)
	auth.observeReply(requestVerb(request), code)
}

it('changes MAIL and RSET admission only on acceptance', () => {
	const auth = new AuthAdmission()
	exchange(auth, 'MAIL FROM:<sender@example.test>\r\n', 550)
	expect(auth.allowsLogin).toBe(true)
	exchange(auth, 'MAIL FROM:<sender@example.test>\r\n', 250)
	exchange(auth, 'RSET\r\n', 500)
	expect(auth.allowsLogin).toBe(false)
	exchange(auth, 'RSET\r\n', 250)
	expect(auth.allowsLogin).toBe(true)
})

it('reports observed authentication only after a successful AUTH exchange', () => {
	const auth = new AuthAdmission()
	exchange(auth, 'AUTH LOGIN\r\n', 334)
	expect(auth.isAuthenticated).toBe(false)
	exchange(auth, 'credential\r\n', 235)
	expect(auth.isAuthenticated).toBe(true)
	expect(auth.allowsLogin).toBe(false)
})

const end = '\r\n.\r\n'
it.each(
	[
		['.\r\n'], // first line in DATA
		['body' + end + 'NOOP\r\n'],
		...Array.from({ length: end.length - 1 }, (_, i) => [
			'body' + end.slice(0, i + 1),
			end.slice(i + 1),
		]),
		['body\r\n.'], // the helper's leading CRLF completes this earlier dot
	].map((chunks) => ({ chunks }))
)(
	'cannot regain login from a later data_end reply after raw dot: $chunks',
	({ chunks }) => {
		const auth = new AuthAdmission()
		exchange(auth, 'DATA\r\n', 354)
		for (const chunk of chunks) auth.untrackedWrite(chunk)
		exchange(auth, end, 250)
		exchange(auth, 'RSET\r\n', 250)
		expect(auth.allowsLogin).toBe(false)
	}
)

it('does not mistake dot-stuffed DATA for the terminator', () => {
	const auth = new AuthAdmission()
	exchange(auth, 'DATA\r\n', 354)
	auth.untrackedWrite('body\r\n.')
	auth.untrackedWrite('.\r\n')
	exchange(auth, end, 250)
	expect(auth.allowsLogin).toBe(true)
})
