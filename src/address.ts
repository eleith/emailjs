import { tokenizeAddress } from './address-tokenizer.js'
import type { AddressToken } from './address-tokenizer.js'

export interface AddressObject {
	address?: string
	name?: string
	group?: AddressObject[]
}

// Convert one mailbox or group token sequence into structured addresses.
function convertAddressTokens(tokens: AddressToken[]) {
	const addressObjects: AddressObject[] = []
	const groups: string[] = []
	let addresses: string[] = []
	let comments: string[] = []
	let texts: string[] = []

	let state = 'text'
	let isGroup = false
	// Collect each text token according to its current address context.
	function handleToken(token: AddressToken) {
		if (token.type === 'operator') {
			switch (token.value) {
				case '<':
					state = 'address'
					break
				case '(':
					state = 'comment'
					break
				case ':':
					state = 'group'
					isGroup = true
					break
				default:
					state = 'text'
					break
			}
		} else if (token.value.length > 0) {
			switch (state) {
				case 'address':
					addresses.push(token.value)
					break
				case 'comment':
					comments.push(token.value)
					break
				case 'group':
					groups.push(token.value)
					break
				default:
					texts.push(token.value)
					break
			}
		}
	}

	// Filter out <addresses>, (comments) and regular text
	for (const token of tokens) {
		handleToken(token)
	}

	// If there is no text but a comment, replace the two
	if (texts.length === 0 && comments.length > 0) {
		texts = [...comments]
		comments = []
	}

	// http://tools.ietf.org/html/rfc2822#appendix-A.1.3
	if (isGroup) {
		addressObjects.push({
			name: texts.length === 0 ? undefined : texts.join(' '),
			group: groups.length > 0 ? addressparser(groups.join(',')) : [],
		})
	} else {
		// If no address was found, try to detect one from regular text
		if (addresses.length === 0 && texts.length > 0) {
			for (let i = texts.length - 1; i >= 0; i--) {
				if (texts[i].match(/^[^@\s]+@[^@\s]+$/)) {
					addresses = texts.splice(i, 1)
					break
				}
			}

			// still no address
			if (addresses.length === 0) {
				for (let i = texts.length - 1; i >= 0; i--) {
					texts[i] = texts[i]
						.replace(/\s*\b[^@\s]+@[^@\s]+\b\s*/, (address: string) => {
							if (addresses.length === 0) {
								addresses = [address.trim()]
								return ' '
							} else {
								return address
							}
						})
						.trim()

					if (addresses.length > 0) {
						break
					}
				}
			}
		}

		// If there's still is no text but a comment exixts, replace the two
		if (texts.length === 0 && comments.length > 0) {
			texts = [...comments]
			comments = []
		}

		// Keep only the first address occurence, push others to regular text
		if (addresses.length > 1) {
			texts = [...texts, ...addresses.splice(1)]
		}

		// Join values with spaces
		let address = addresses.join(' ')
		let name = texts.length === 0 ? address : texts.join(' ')

		if (address === name) {
			if (address.match(/@/)) {
				name = ''
			} else {
				address = ''
			}
		}

		addressObjects.push({ address, name })
	}

	return addressObjects
}

// Split top-level address tokens and convert each mailbox or group.
export function addressparser(address?: string | string[]) {
	const addresses: AddressObject[] = []
	let tokens: AddressToken[] = []

	for (const token of tokenizeAddress(address)) {
		if (
			token.type === 'operator' &&
			(token.value === ',' || token.value === ';')
		) {
			if (tokens.length > 0) {
				addresses.push(...convertAddressTokens(tokens))
			}
			tokens = []
		} else {
			tokens.push(token)
		}
	}

	if (tokens.length > 0) {
		addresses.push(...convertAddressTokens(tokens))
	}

	return addresses
}
