const CRLF = '\r\n'
const MAX_ENCODED_HEADER_LINE_LENGTH = 76

export function formatHeaderName(name: string): string {
	return name
		.toLowerCase()
		.replace(/^(.)|-(.)/g, (match) => match.toUpperCase())
}

/**
 * Sanitizes a header value to prevent CRLF header injection (CWE-93)
 */
export function sanitizeHeaderValue(value: string): string {
	return value.replace(/\r?\n|\r/g, '')
}

export function foldSubject(value: string): string {
	const words = value.split(' ')
	const lines = [words[0]]
	let lineLength = 'Subject: '.length + words[0].length

	// RFC 2047 limits lines containing encoded words to 76 characters.
	for (const word of words.slice(1)) {
		if (lineLength + 1 + word.length > MAX_ENCODED_HEADER_LINE_LENGTH) {
			lines.push(` ${word}`)
			lineLength = 1 + word.length
		} else {
			lines[lines.length - 1] += ` ${word}`
			lineLength += 1 + word.length
		}
	}

	return lines.join(CRLF)
}
