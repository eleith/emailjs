export const SMTPErrorStates = {
	COULDNOTCONNECT: 1,
	BADRESPONSE: 2,
	AUTHFAILED: 3,
	TIMEDOUT: 4,
	ERROR: 5,
	NOCONNECTION: 6,
	AUTHNOTSUPPORTED: 7,
	CONNECTIONCLOSED: 8,
	CONNECTIONENDED: 9,
	CONNECTIONAUTH: 10,
} as const

export type SMTPErrorState =
	(typeof SMTPErrorStates)[keyof typeof SMTPErrorStates]

export class SMTPError extends Error {
	public code: SMTPErrorState | null = null
	public smtp: unknown = null
	public previous: Error | null = null

	protected constructor(message: string) {
		super(message)
	}

	public static create(
		message: string,
		code: SMTPErrorState,
		error?: Error | null,
		smtp?: unknown
	) {
		const msg = error?.message ? `${message} (${error.message})` : message
		const err = new SMTPError(msg)

		err.code = code
		err.smtp = smtp

		if (error) {
			err.previous = error
		}

		return err
	}
}
