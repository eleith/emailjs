export interface AddressToken {
	type: 'operator' | 'text'
	value: string
}

const OPERATORS = new Set([
	'"',
	'(',
	'<',
	',',
	':',
	// Accept standalone semicolons as legacy comma-equivalent separators.
	';',
])

// Find an unescaped closer (or recovery ';'), returning input.length if unfinished.
function scanEscapedSpan(
	input: string,
	start: number,
	closers: '"' | ']' | '];'
) {
	for (let i = start + 1; i < input.length; i++) {
		if (input[i] === '\\') {
			i++
		} else if (closers.includes(input[i])) {
			return i
		}
	}
	return input.length
}

// Find the outermost comment closer iteratively, or input.length if unfinished.
function scanComment(input: string, start: number) {
	let depth = 1
	for (let i = start + 1; i < input.length; i++) {
		if (input[i] === '\\') {
			i++
		} else if (input[i] === '(') {
			depth++
		} else if (input[i] === ')') {
			depth--
			if (depth === 0) {
				return i
			}
		}
	}
	return input.length
}

// Find '>' (or recovery ';' inside a group), or input.length if unfinished.
function scanAngleAddress(
	input: string,
	start: number,
	stopAtGroupTerminator = false
) {
	let afterAt = false
	for (let i = start + 1; i < input.length; i++) {
		const character = input[i]
		if (character === '>' || (stopAtGroupTerminator && character === ';')) {
			return i
		}
		if (character === '"') {
			i = scanEscapedSpan(input, i, '"')
		} else if (character === '(') {
			i = scanComment(input, i)
		} else if (character === '[' && afterAt) {
			i = scanEscapedSpan(input, i, ']')
		} else if (character.trim().length > 0) {
			afterAt = character === '@'
		}
	}
	return input.length
}

// Find an unprotected group terminator, or input.length if unfinished.
function scanGroup(input: string, start: number) {
	let afterAt = false
	for (let i = start + 1; i < input.length; i++) {
		if (input[i] === ';') {
			return i
		}
		if (input[i] === '"') {
			i = scanEscapedSpan(input, i, '"')
		} else if (input[i] === '(') {
			i = scanComment(input, i)
		} else if (input[i] === '<') {
			i = scanAngleAddress(input, i, true)
			if (input[i] === ';') {
				return i
			}
			afterAt = false
		} else if (input[i] === '[' && afterAt) {
			// Stop at ';' in bare literals to preserve recovery without repeated lookahead.
			i = scanEscapedSpan(input, i, '];')
			if (input[i] === ';') {
				return i
			}
			afterAt = false
		} else if (input[i].trim().length > 0) {
			afterAt = input[i] === '@'
		}
	}
	return input.length
}

// Emit operator/text tokens, decoding quoted-pairs only in names and comments.
export function tokenizeAddress(address: string | string[] = '') {
	const input = address.toString()
	const tokens: AddressToken[] = []
	let cursor = 0

	// Trim and emit nonempty text tokens.
	function addText(value: string) {
		value = value.trim()
		if (value.length > 0) {
			tokens.push({ type: 'text', value })
		}
	}

	while (cursor < input.length) {
		const start = cursor
		const character = input[cursor++]
		if (!OPERATORS.has(character)) {
			while (cursor < input.length && !OPERATORS.has(input[cursor])) {
				cursor++
			}
			addText(input.slice(start, cursor))
			continue
		}

		tokens.push({ type: 'operator', value: character })
		let end: number
		switch (character) {
			case '"':
				end = scanEscapedSpan(input, start, '"')
				break
			case '(':
				end = scanComment(input, start)
				break
			case '<':
				end = scanAngleAddress(input, start)
				break
			case ':':
				end = scanGroup(input, start)
				break
			default:
				continue // Commas and standalone semicolons have no contents.
		}

		const contents = input.slice(cursor, end)
		// Preserve raw group/address syntax; decode only complete name/comment quoted-pairs.
		addText(
			character === '"' || character === '('
				? contents.replace(/\\([\s\S])/g, '$1')
				: contents
		)
		if (end < input.length) {
			tokens.push({ type: 'operator', value: input[end] })
		}
		cursor = end + 1
	}

	return tokens
}
