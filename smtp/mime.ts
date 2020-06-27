// adapted from https://github.com/emailjs/emailjs-mime-codec/blob/6909c706b9f09bc0e5c3faf48f723cca53e5b352/src/mimecodec.js
import { TextDecoder, TextEncoder } from 'util';

const encoder = new TextEncoder();

/**
 * @see https://tools.ietf.org/html/rfc2045#section-6.7
 */
const RANGES = [
	[0x09], // <TAB>
	[0x0a], // <LF>
	[0x0d], // <CR>
	[0x20, 0x3c], // <SP>!"#$%&'()*+,-./0123456789:;
	[0x3e, 0x7e], // >?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\]^_`abcdefghijklmnopqrstuvwxyz{|}
];
const LOOKUP = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.split(
	''
);
const MAX_CHUNK_LENGTH = 16383; // must be multiple of 3
const MAX_MIME_WORD_LENGTH = 52;
const MAX_B64_MIME_WORD_BYTE_LENGTH = 39;

function tripletToBase64(num: number) {
	return (
		LOOKUP[(num >> 18) & 0x3f] +
		LOOKUP[(num >> 12) & 0x3f] +
		LOOKUP[(num >> 6) & 0x3f] +
		LOOKUP[num & 0x3f]
	);
}

function encodeChunk(uint8: Uint8Array, start: number, end: number) {
	let output = '';
	for (let i = start; i < end; i += 3) {
		output += tripletToBase64(
			(uint8[i] << 16) + (uint8[i + 1] << 8) + uint8[i + 2]
		);
	}
	return output;
}

function encodeBase64(data: Uint8Array) {
	const len = data.length;
	const extraBytes = len % 3; // if we have 1 byte left, pad 2 bytes
	let output = '';

	// go through the array every three bytes, we'll deal with trailing stuff later
	for (let i = 0, len2 = len - extraBytes; i < len2; i += MAX_CHUNK_LENGTH) {
		output += encodeChunk(
			data,
			i,
			i + MAX_CHUNK_LENGTH > len2 ? len2 : i + MAX_CHUNK_LENGTH
		);
	}

	// pad the end with zeros, but make sure to not forget the extra bytes
	if (extraBytes === 1) {
		const tmp = data[len - 1];
		output += LOOKUP[tmp >> 2];
		output += LOOKUP[(tmp << 4) & 0x3f];
		output += '==';
	} else if (extraBytes === 2) {
		const tmp = (data[len - 2] << 8) + data[len - 1];
		output += LOOKUP[tmp >> 10];
		output += LOOKUP[(tmp >> 4) & 0x3f];
		output += LOOKUP[(tmp << 2) & 0x3f];
		output += '=';
	}

	return output;
}

/**
 * Splits a mime encoded string. Needed for dividing mime words into smaller chunks
 *
 * @param {string} str Mime encoded string to be split up
 * @param {number} maxlen Maximum length of characters for one part (minimum 12)
 * @return {string[]} lines
 */
function splitMimeEncodedString(str: string, maxlen = 12) {
	const minWordLength = 12; // require at least 12 symbols to fit possible 4 octet UTF-8 sequences
	const maxWordLength = Math.max(maxlen, minWordLength);
	const lines: string[] = [];

	while (str.length) {
		let curLine = str.substr(0, maxWordLength);

		const match = curLine.match(/=[0-9A-F]?$/i); // skip incomplete escaped char
		if (match) {
			curLine = curLine.substr(0, match.index);
		}

		let done = false;
		while (!done) {
			let chr;
			done = true;
			const match = str.substr(curLine.length).match(/^=([0-9A-F]{2})/i); // check if not middle of a unicode char sequence
			if (match) {
				chr = parseInt(match[1], 16);
				// invalid sequence, move one char back anc recheck
				if (chr < 0xc2 && chr > 0x7f) {
					curLine = curLine.substr(0, curLine.length - 3);
					done = false;
				}
			}
		}

		if (curLine.length) {
			lines.push(curLine);
		}
		str = str.substr(curLine.length);
	}

	return lines;
}

/**
 *
 * @param {number} nr number
 * @returns {boolean} if number is in range
 */
function checkRanges(nr: number) {
	return RANGES.reduce(
		(val, range) =>
			val ||
			(range.length === 1 && nr === range[0]) ||
			(range.length === 2 && nr >= range[0] && nr <= range[1]),
		false
	);
}

/**
 * Encodes all non printable and non ascii bytes to =XX form, where XX is the
 * byte value in hex. This function does not convert linebreaks etc. it
 * only escapes character sequences
 *
 * NOTE: Encoding support depends on util.TextDecoder, which is severely limited
 * prior to Node.js 13.
 *
 * @see https://nodejs.org/api/util.html#util_whatwg_supported_encodings
 * @see https://github.com/nodejs/node/issues/19214
 *
 * @param {string|Uint8Array} data Either a string or an Uint8Array
 * @param {string} encoding WHATWG supported encoding
 * @return {string} Mime encoded string
 */
export function mimeEncode(data: string | Uint8Array = '', encoding = 'utf-8') {
	const decoder = new TextDecoder(encoding);
	const buffer =
		typeof data === 'string'
			? encoder.encode(data)
			: encoder.encode(decoder.decode(data));

	return buffer.reduce(
		(aggregate, ord, index) =>
			checkRanges(ord) &&
			!(
				(ord === 0x20 || ord === 0x09) &&
				(index === buffer.length - 1 ||
					buffer[index + 1] === 0x0a ||
					buffer[index + 1] === 0x0d)
			)
				? // if the char is in allowed range, then keep as is, unless it is a ws in the end of a line
				  aggregate + String.fromCharCode(ord)
				: `${aggregate}=${ord < 0x10 ? '0' : ''}${ord
						.toString(16)
						.toUpperCase()}`,
		''
	);
}

/**
 * Encodes a string or an Uint8Array to an UTF-8 MIME Word
 *
 * NOTE: Encoding support depends on util.TextDecoder, which is severely limited
 * prior to Node.js 13.
 *
 * @see https://tools.ietf.org/html/rfc2047
 * @see https://nodejs.org/api/util.html#util_whatwg_supported_encodings
 * @see https://github.com/nodejs/node/issues/19214
 *
 * @param {string|Uint8Array} data String to be encoded
 * @param {'Q' | 'B'} mimeWordEncoding='Q' Encoding for the mime word, either Q or B
 * @param {string} encoding WHATWG supported encoding
 * @return {string} Single or several mime words joined together
 */
export function mimeWordEncode(
	data: string | Uint8Array,
	mimeWordEncoding: 'Q' | 'B' = 'Q',
	encoding = 'utf-8'
) {
	let parts: string[] = [];
	const decoder = new TextDecoder(encoding);
	const str = typeof data === 'string' ? data : decoder.decode(data);

	if (mimeWordEncoding === 'Q') {
		const encodedStr = mimeEncode(str, encoding).replace(
			/[^a-z0-9!*+\-/=]/gi,
			(chr: string) =>
				chr === ' '
					? '_'
					: '=' +
					  (chr.charCodeAt(0) < 0x10 ? '0' : '') +
					  chr.charCodeAt(0).toString(16).toUpperCase()
		);
		parts =
			encodedStr.length < MAX_MIME_WORD_LENGTH
				? [encodedStr]
				: splitMimeEncodedString(encodedStr, MAX_MIME_WORD_LENGTH);
	} else {
		// Fits as much as possible into every line without breaking utf-8 multibyte characters' octets up across lines
		let j = 0;
		let i = 0;
		while (i < str.length) {
			if (
				encoder.encode(str.substring(j, i)).length >
				MAX_B64_MIME_WORD_BYTE_LENGTH
			) {
				// we went one character too far, substring at the char before
				parts.push(str.substring(j, i - 1));
				j = i - 1;
			} else {
				i++;
			}
		}
		// add the remainder of the string
		str.substring(j) && parts.push(str.substring(j));
		parts = parts.map((x) => encoder.encode(x)).map((x) => encodeBase64(x));
	}

	return parts
		.map((p) => `=?UTF-8?${mimeWordEncoding}?${p}?= `)
		.join('')
		.trim();
}
