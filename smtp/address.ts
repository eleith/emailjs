/*
 * Operator tokens and which tokens are expected to end the sequence
 */
const OPERATORS = {
	'"': '"',
	'(': ')',
	'<': '>',
	',': '',
	// Groups are ended by semicolons
	':': ';',
	// Semicolons are not a legal delimiter per the RFC2822 grammar other
	// than for terminating a group, but they are also not valid for any
	// other use in this context.  Given that some mail clients have
	// historically allowed the semicolon as a delimiter equivalent to the
	// comma in their UI, it makes sense to treat them the same as a comma
	// when used outside of a group.
	';': '',
};

interface TokenizerNode {
	type: 'operator' | 'text';
	value: string;
}

export interface AddressObject {
	address?: string;
	name?: string;
	group?: AddressObject[];
}

/**
 * Creates a Tokenizer object for tokenizing address field strings
 *
 * @constructor
 * @param {String} str Address field string
 */
class Tokenizer {
	private operatorExpecting = '';
	private node?: TokenizerNode;
	private escaped = false;
	private list: TokenizerNode[] = [];
	private str: string;

	constructor(str: string | string[] = '') {
		this.str = str.toString();
	}

	/**
	 * Tokenizes the original input string
	 *
	 * @return {Array} An array of operator|text tokens
	 */
	public tokenize() {
		let chr;
		const list: TokenizerNode[] = [];

		for (let i = 0, len = this.str.length; i < len; i++) {
			chr = this.str.charAt(i);
			this.checkChar(chr);
		}

		for (const node of this.list) {
			node.value = (node.value || '').toString().trim();
			if (node.value) {
				list.push(node);
			}
		}

		return list;
	}

	/**
	 * Checks if a character is an operator or text and acts accordingly
	 *
	 * @param {string} chr Character from the address field
	 * @returns {void}
	 */
	public checkChar(chr: string) {
		if ((chr in OPERATORS || chr === '\\') && this.escaped) {
			this.escaped = false;
		} else if (this.operatorExpecting && chr === this.operatorExpecting) {
			this.node = {
				type: 'operator',
				value: chr,
			};
			this.list.push(this.node);
			this.node = undefined;
			this.operatorExpecting = '';
			this.escaped = false;
			return;
		} else if (!this.operatorExpecting && chr in OPERATORS) {
			this.node = {
				type: 'operator',
				value: chr,
			};
			this.list.push(this.node);
			this.node = undefined;
			this.operatorExpecting = OPERATORS[chr as keyof typeof OPERATORS];
			this.escaped = false;
			return;
		}

		if (!this.escaped && chr === '\\') {
			this.escaped = true;
			return;
		}

		if (!this.node) {
			this.node = {
				type: 'text',
				value: '',
			};
			this.list.push(this.node);
		}

		if (this.escaped && chr !== '\\') {
			this.node.value += '\\';
		}

		this.node.value += chr;
		this.escaped = false;
	}
}
/**
 * Converts tokens for a single address into an address object
 *
 * @param {TokenizerNode[]} tokens Tokens object
 * @return {AddressObject[]} addresses object array
 */
function handleAddress(tokens: TokenizerNode[]) {
	let isGroup = false;
	let state = 'text';

	let address: AddressObject;

	let addresses: string[] = [];
	let comments: string[] = [];
	let texts: string[] = [];

	const groups: string[] = [];
	const addressObjects: AddressObject[] = [];

	const data: {
		address: string;
		comment: string;
		group: string;
		text: string;
	} = {
		address: '',
		comment: '',
		group: '',
		text: '',
	};

	// Filter out <addresses>, (comments) and regular text
	for (let i = 0, len = tokens.length; i < len; i++) {
		const token = tokens[i];

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
		} else {
			if (token.value) {
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
	}

	// If there is no text but a comment, replace the two
	if (texts.length === 0 && comments.length > 0) {
		texts = [...comments];
		comments = [];
	}

	if (isGroup) {
		// http://tools.ietf.org/html/rfc2822#appendix-A.1.3
		data.text = texts.join(' ');
		addressObjects.push({
			name: data.text || undefined,
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

			const _regexHandler = function (address: string) {
				if (addresses.length === 0) {
					addresses = [address.trim()];
					return ' ';
				} else {
					return address;
				}
			};

			// still no address
			if (addresses.length === 0) {
				for (let i = texts.length - 1; i >= 0; i--) {
					texts[i] = texts[i]
						.replace(/\s*\b[^@\s]+@[^@\s]+\b\s*/, _regexHandler)
						.trim();
					if (addresses.length) {
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
			texts = texts.concat(addresses.splice(1));
		}

		// Join values with spaces
		data.text = texts.join(' ');
		data.address = addresses.join(' ');

		if (!data.address && isGroup) {
			return [];
		} else {
			address = {
				address: data.address || data.text || '',
				name: data.text || data.address || '',
			};

			if (address.address === address.name) {
				if ((address.address || '').match(/@/)) {
					address.name = '';
				} else {
					address.address = '';
				}
			}

			addressObjects.push(address);
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
 * @param {string} str Address field
 * @return {AddressObject[]} An array of address objects
 */
export function addressparser(str?: string | string[]) {
	const tokenizer = new Tokenizer(str);
	const tokens = tokenizer.tokenize();

	const addresses: TokenizerNode[][] = [];
	let address: TokenizerNode[] = [];
	let parsedAddresses: AddressObject[] = [];

	for (const token of tokens) {
		if (
			token.type === 'operator' &&
			(token.value === ',' || token.value === ';')
		) {
			if (address.length) {
				addresses.push(address);
			}
			address = [];
		} else {
			address.push(token);
		}
	}

	if (address.length) {
		addresses.push(address);
	}

	for (const address of addresses) {
		const handled = handleAddress(address);
		if (handled.length) {
			parsedAddresses = parsedAddresses.concat(handled);
		}
	}

	return parsedAddresses;
}
