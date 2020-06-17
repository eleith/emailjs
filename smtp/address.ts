interface AddressToken {
	type: 'operator' | 'text';
	value: string;
}

export interface AddressObject {
	address?: string;
	name?: string;
	group?: AddressObject[];
}

/*
 * Operator tokens and which tokens are expected to end the sequence
 */
const OPERATORS = new Map([
	['"', '"'],
	['(', ')'],
	['<', '>'],
	[',', ''],
	// Groups are ended by semicolons
	[':', ';'],
	// Semicolons are not a legal delimiter per the RFC2822 grammar other
	// than for terminating a group, but they are also not valid for any
	// other use in this context.  Given that some mail clients have
	// historically allowed the semicolon as a delimiter equivalent to the
	// comma in their UI, it makes sense to treat them the same as a comma
	// when used outside of a group.
	[';', ''],
]);

/**
 * Tokenizes the original input string
 *
 * @param {string | string[] | undefined} address string(s) to tokenize
 * @return {AddressToken[]} An array of operator|text tokens
 */
function tokenizeAddress(address: string | string[] = '') {
	const tokens: AddressToken[] = [];
	let token: AddressToken | undefined = undefined;
	let operator: string | undefined = undefined;

	for (const character of address.toString()) {
		if ((operator?.length ?? 0) > 0 && character === operator) {
			tokens.push({ type: 'operator', value: character });
			token = undefined;
			operator = undefined;
		} else if ((operator?.length ?? 0) === 0 && OPERATORS.has(character)) {
			tokens.push({ type: 'operator', value: character });
			token = undefined;
			operator = OPERATORS.get(character);
		} else {
			if (token == null) {
				token = { type: 'text', value: character };
				tokens.push(token);
			} else {
				token.value += character;
			}
		}
	}

	return tokens
		.map((x) => {
			x.value = x.value.trim();
			return x;
		})
		.filter((x) => x.value.length > 0);
}

/**
 * Converts tokens for a single address into an address object
 *
 * @param {AddressToken[]} tokens Tokens object
 * @return {AddressObject[]} addresses object array
 */
function convertAddressTokens(tokens: AddressToken[]) {
	const addressObjects: AddressObject[] = [];
	const groups: string[] = [];
	let addresses: string[] = [];
	let comments: string[] = [];
	let texts: string[] = [];

	let state = 'text';
	let isGroup = false;
	function handleToken(token: AddressToken) {
		if (token.type === 'operator') {
			switch (token.value) {
				case '<':
					state = 'address';
					break;
				case '(':
					state = 'comment';
					break;
				case ':':
					state = 'group';
					isGroup = true;
					break;
				default:
					state = 'text';
					break;
			}
		} else if (token.value.length > 0) {
			switch (state) {
				case 'address':
					addresses.push(token.value);
					break;
				case 'comment':
					comments.push(token.value);
					break;
				case 'group':
					groups.push(token.value);
					break;
				default:
					texts.push(token.value);
					break;
			}
		}
	}

	// Filter out <addresses>, (comments) and regular text
	for (const token of tokens) {
		handleToken(token);
	}

	// If there is no text but a comment, replace the two
	if (texts.length === 0 && comments.length > 0) {
		texts = [...comments];
		comments = [];
	}

	// http://tools.ietf.org/html/rfc2822#appendix-A.1.3
	if (isGroup) {
		addressObjects.push({
			name: texts.length === 0 ? undefined : texts.join(' '),
			group: groups.length > 0 ? addressparser(groups.join(',')) : [],
		});
	} else {
		// If no address was found, try to detect one from regular text
		if (addresses.length === 0 && texts.length > 0) {
			for (let i = texts.length - 1; i >= 0; i--) {
				if (texts[i].match(/^[^@\s]+@[^@\s]+$/)) {
					addresses = texts.splice(i, 1);
					break;
				}
			}

			// still no address
			if (addresses.length === 0) {
				for (let i = texts.length - 1; i >= 0; i--) {
					texts[i] = texts[i]
						.replace(/\s*\b[^@\s]+@[^@\s]+\b\s*/, (address: string) => {
							if (addresses.length === 0) {
								addresses = [address.trim()];
								return ' ';
							} else {
								return address;
							}
						})
						.trim();

					if (addresses.length > 0) {
						break;
					}
				}
			}
		}

		// If there's still is no text but a comment exixts, replace the two
		if (texts.length === 0 && comments.length > 0) {
			texts = [...comments];
			comments = [];
		}

		// Keep only the first address occurence, push others to regular text
		if (addresses.length > 1) {
			texts = [...texts, ...addresses.splice(1)];
		}

		if (addresses.length === 0 && isGroup) {
			return [];
		} else {
			// Join values with spaces
			let address = addresses.join(' ');
			let name = texts.length === 0 ? address : texts.join(' ');

			if (address === name) {
				if (address.match(/@/)) {
					name = '';
				} else {
					address = '';
				}
			}

			addressObjects.push({ address, name });
		}
	}

	return addressObjects;
}

/**
 * Parses structured e-mail addresses from an address field
 *
 * Example:
 *
 *    "Name <address@domain>"
 *
 * will be converted to
 *
 *     [{name: "Name", address: "address@domain"}]
 *
 * @param {string | string[] | undefined} address Address field
 * @return {AddressObject[]} An array of address objects
 */
export function addressparser(address?: string | string[]) {
	const addresses: AddressObject[] = [];
	let tokens: AddressToken[] = [];

	for (const token of tokenizeAddress(address)) {
		if (
			token.type === 'operator' &&
			(token.value === ',' || token.value === ';')
		) {
			if (tokens.length > 0) {
				addresses.push(...convertAddressTokens(tokens));
			}
			tokens = [];
		} else {
			tokens.push(token);
		}
	}

	if (tokens.length > 0) {
		addresses.push(...convertAddressTokens(tokens));
	}

	return addresses;
}
