import { existsSync, open, read, closeSync, close } from 'fs';
import { hostname } from 'os';
import { Stream } from 'stream';
import { TextEncoder, TextDecoder } from 'util';
import { createHmac } from 'crypto';
import { EventEmitter } from 'events';
import { Socket } from 'net';
import { connect, TLSSocket, createSecureContext } from 'tls';

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
function tokenizeAddress(address = '') {
    var _a, _b;
    const tokens = [];
    let token = undefined;
    let operator = undefined;
    for (const character of address.toString()) {
        if (((_a = operator === null || operator === void 0 ? void 0 : operator.length) !== null && _a !== void 0 ? _a : 0) > 0 && character === operator) {
            tokens.push({ type: 'operator', value: character });
            token = undefined;
            operator = undefined;
        }
        else if (((_b = operator === null || operator === void 0 ? void 0 : operator.length) !== null && _b !== void 0 ? _b : 0) === 0 && OPERATORS.has(character)) {
            tokens.push({ type: 'operator', value: character });
            token = undefined;
            operator = OPERATORS.get(character);
        }
        else {
            if (token == null) {
                token = { type: 'text', value: character };
                tokens.push(token);
            }
            else {
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
function convertAddressTokens(tokens) {
    const addressObjects = [];
    const groups = [];
    let addresses = [];
    let comments = [];
    let texts = [];
    let state = 'text';
    let isGroup = false;
    function handleToken(token) {
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
        }
        else if (token.value.length > 0) {
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
    }
    else {
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
                        .replace(/\s*\b[^@\s]+@[^@\s]+\b\s*/, (address) => {
                        if (addresses.length === 0) {
                            addresses = [address.trim()];
                            return ' ';
                        }
                        else {
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
        }
        else {
            // Join values with spaces
            let address = addresses.join(' ');
            let name = texts.length === 0 ? address : texts.join(' ');
            if (address === name) {
                if (address.match(/@/)) {
                    name = '';
                }
                else {
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
function addressparser(address) {
    const addresses = [];
    let tokens = [];
    for (const token of tokenizeAddress(address)) {
        if (token.type === 'operator' &&
            (token.value === ',' || token.value === ';')) {
            if (tokens.length > 0) {
                addresses.push(...convertAddressTokens(tokens));
            }
            tokens = [];
        }
        else {
            tokens.push(token);
        }
    }
    if (tokens.length > 0) {
        addresses.push(...convertAddressTokens(tokens));
    }
    return addresses;
}

/**
 * @param {Date} [date] an optional date to convert to RFC2822 format
 * @param {boolean} [useUtc] whether to parse the date as UTC (default: false)
 * @returns {string} the converted date
 */
function getRFC2822Date(date = new Date(), useUtc = false) {
    if (useUtc) {
        return getRFC2822DateUTC(date);
    }
    const dates = date
        .toString()
        .replace('GMT', '')
        .replace(/\s\(.*\)$/, '')
        .split(' ');
    dates[0] = dates[0] + ',';
    const day = dates[1];
    dates[1] = dates[2];
    dates[2] = day;
    return dates.join(' ');
}
/**
 * @param {Date} [date] an optional date to convert to RFC2822 format (UTC)
 * @returns {string} the converted date
 */
function getRFC2822DateUTC(date = new Date()) {
    const dates = date.toUTCString().split(' ');
    dates.pop(); // remove timezone
    dates.push('+0000');
    return dates.join(' ');
}
/**
 * RFC 2822 regex
 * @see https://tools.ietf.org/html/rfc2822#section-3.3
 * @see https://github.com/moment/moment/blob/a831fc7e2694281ce31e4f090bbcf90a690f0277/src/lib/create/from-string.js#L101
 */
const rfc2822re = /^(?:(Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s)?(\d{1,2})\s(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s(\d{2,4})\s(\d\d):(\d\d)(?::(\d\d))?\s(?:(UT|GMT|[ECMP][SD]T)|([Zz])|([+-]\d{4}))$/;
/**
 * @param {string} [date] a string to check for conformance to the [rfc2822](https://tools.ietf.org/html/rfc2822#section-3.3) standard
 * @returns {boolean} the result of the conformance check
 */
function isRFC2822Date(date) {
    return rfc2822re.test(date);
}

// adapted from https://github.com/emailjs/emailjs-mime-codec/blob/6909c706b9f09bc0e5c3faf48f723cca53e5b352/src/mimecodec.js
const encoder = new TextEncoder();
/**
 * @see https://tools.ietf.org/html/rfc2045#section-6.7
 */
const RANGES = [
    [0x09],
    [0x0a],
    [0x0d],
    [0x20, 0x3c],
    [0x3e, 0x7e], // >?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\]^_`abcdefghijklmnopqrstuvwxyz{|}
];
const LOOKUP = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.split('');
const MAX_CHUNK_LENGTH = 16383; // must be multiple of 3
const MAX_MIME_WORD_LENGTH = 52;
const MAX_B64_MIME_WORD_BYTE_LENGTH = 39;
function tripletToBase64(num) {
    return (LOOKUP[(num >> 18) & 0x3f] +
        LOOKUP[(num >> 12) & 0x3f] +
        LOOKUP[(num >> 6) & 0x3f] +
        LOOKUP[num & 0x3f]);
}
function encodeChunk(uint8, start, end) {
    let output = '';
    for (let i = start; i < end; i += 3) {
        output += tripletToBase64((uint8[i] << 16) + (uint8[i + 1] << 8) + uint8[i + 2]);
    }
    return output;
}
function encodeBase64(data) {
    const len = data.length;
    const extraBytes = len % 3; // if we have 1 byte left, pad 2 bytes
    let output = '';
    // go through the array every three bytes, we'll deal with trailing stuff later
    for (let i = 0, len2 = len - extraBytes; i < len2; i += MAX_CHUNK_LENGTH) {
        output += encodeChunk(data, i, i + MAX_CHUNK_LENGTH > len2 ? len2 : i + MAX_CHUNK_LENGTH);
    }
    // pad the end with zeros, but make sure to not forget the extra bytes
    if (extraBytes === 1) {
        const tmp = data[len - 1];
        output += LOOKUP[tmp >> 2];
        output += LOOKUP[(tmp << 4) & 0x3f];
        output += '==';
    }
    else if (extraBytes === 2) {
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
function splitMimeEncodedString(str, maxlen = 12) {
    const minWordLength = 12; // require at least 12 symbols to fit possible 4 octet UTF-8 sequences
    const maxWordLength = Math.max(maxlen, minWordLength);
    const lines = [];
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
function checkRanges(nr) {
    return RANGES.reduce((val, range) => val ||
        (range.length === 1 && nr === range[0]) ||
        (range.length === 2 && nr >= range[0] && nr <= range[1]), false);
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
function mimeEncode(data = '', encoding = 'utf-8') {
    const decoder = new TextDecoder(encoding);
    const buffer = typeof data === 'string'
        ? encoder.encode(data)
        : encoder.encode(decoder.decode(data));
    return buffer.reduce((aggregate, ord, index) => checkRanges(ord) &&
        !((ord === 0x20 || ord === 0x09) &&
            (index === buffer.length - 1 ||
                buffer[index + 1] === 0x0a ||
                buffer[index + 1] === 0x0d))
        ? // if the char is in allowed range, then keep as is, unless it is a ws in the end of a line
            aggregate + String.fromCharCode(ord)
        : `${aggregate}=${ord < 0x10 ? '0' : ''}${ord
            .toString(16)
            .toUpperCase()}`, '');
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
function mimeWordEncode(data, mimeWordEncoding = 'Q', encoding = 'utf-8') {
    let parts = [];
    const decoder = new TextDecoder(encoding);
    const str = typeof data === 'string' ? data : decoder.decode(data);
    if (mimeWordEncoding === 'Q') {
        const encodedStr = mimeEncode(str, encoding).replace(/[^a-z0-9!*+\-/=]/gi, (chr) => chr === ' '
            ? '_'
            : '=' +
                (chr.charCodeAt(0) < 0x10 ? '0' : '') +
                chr.charCodeAt(0).toString(16).toUpperCase());
        parts =
            encodedStr.length < MAX_MIME_WORD_LENGTH
                ? [encodedStr]
                : splitMimeEncodedString(encodedStr, MAX_MIME_WORD_LENGTH);
    }
    else {
        // Fits as much as possible into every line without breaking utf-8 multibyte characters' octets up across lines
        let j = 0;
        let i = 0;
        while (i < str.length) {
            if (encoder.encode(str.substring(j, i)).length >
                MAX_B64_MIME_WORD_BYTE_LENGTH) {
                // we went one character too far, substring at the char before
                parts.push(str.substring(j, i - 1));
                j = i - 1;
            }
            else {
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

const CRLF$1 = '\r\n';
/**
 * MIME standard wants 76 char chunks when sending out.
 */
const MIMECHUNK = 76;
/**
 * meets both base64 and mime divisibility
 */
const MIME64CHUNK = (MIMECHUNK * 6);
/**
 * size of the message stream buffer
 */
const BUFFERSIZE = (MIMECHUNK * 24 * 7);
let counter = 0;
function generateBoundary() {
    let text = '';
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'()+_,-./:=?";
    for (let i = 0; i < 69; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
function convertPersonToAddress(person) {
    return addressparser(person)
        .map(({ name, address }) => {
        return name
            ? `${mimeWordEncode(name).replace(/,/g, '=2C')} <${address}>`
            : address;
    })
        .join(', ');
}
function convertDashDelimitedTextToSnakeCase(text) {
    return text
        .toLowerCase()
        .replace(/^(.)|-(.)/g, (match) => match.toUpperCase());
}
class Message {
    /**
     * Construct an rfc2822-compliant message object.
     *
     * Special notes:
     * - The `from` field is required.
     * - At least one `to`, `cc`, or `bcc` header is also required.
     * - You can also add whatever other headers you want.
     *
     * @see https://tools.ietf.org/html/rfc2822
     * @param {Partial<MessageHeaders>} headers Message headers
     */
    constructor(headers) {
        this.attachments = [];
        this.header = {
            'message-id': `<${new Date().getTime()}.${counter++}.${process.pid}@${hostname()}>`,
            date: getRFC2822Date(),
        };
        this.content = 'text/plain; charset=utf-8';
        this.alternative = null;
        for (const header in headers) {
            // allow user to override default content-type to override charset or send a single non-text message
            if (/^content-type$/i.test(header)) {
                this.content = headers[header];
            }
            else if (header === 'text') {
                this.text = headers[header];
            }
            else if (header === 'attachment' &&
                typeof headers[header] === 'object') {
                const attachment = headers[header];
                if (Array.isArray(attachment)) {
                    for (let i = 0; i < attachment.length; i++) {
                        this.attach(attachment[i]);
                    }
                }
                else if (attachment != null) {
                    this.attach(attachment);
                }
            }
            else if (header === 'subject') {
                this.header.subject = mimeWordEncode(headers.subject);
            }
            else if (/^(cc|bcc|to|from)/i.test(header)) {
                this.header[header.toLowerCase()] = convertPersonToAddress(headers[header]);
            }
            else {
                // allow any headers the user wants to set??
                this.header[header.toLowerCase()] = headers[header];
            }
        }
    }
    /**
     * Attach a file to the message.
     *
     * Can be called multiple times, each adding a new attachment.
     *
     * @public
     * @param {MessageAttachment} options attachment options
     * @returns {Message} the current instance for chaining
     */
    attach(options) {
        // sender can specify an attachment as an alternative
        if (options.alternative) {
            this.alternative = options;
            this.alternative.charset = options.charset || 'utf-8';
            this.alternative.type = options.type || 'text/html';
            this.alternative.inline = true;
        }
        else {
            this.attachments.push(options);
        }
        return this;
    }
    /**
     * @public
     * @returns {{ isValid: boolean, validationError: (string | undefined) }} an object specifying whether this message is validly formatted, and the first validation error if it is not.
     */
    checkValidity() {
        if (typeof this.header.from !== 'string' &&
            Array.isArray(this.header.from) === false) {
            return {
                isValid: false,
                validationError: 'Message must have a `from` header',
            };
        }
        if (typeof this.header.to !== 'string' &&
            Array.isArray(this.header.to) === false &&
            typeof this.header.cc !== 'string' &&
            Array.isArray(this.header.cc) === false &&
            typeof this.header.bcc !== 'string' &&
            Array.isArray(this.header.bcc) === false) {
            return {
                isValid: false,
                validationError: 'Message must have at least one `to`, `cc`, or `bcc` header',
            };
        }
        if (this.attachments.length > 0) {
            const failed = [];
            this.attachments.forEach((attachment) => {
                if (attachment.path) {
                    if (existsSync(attachment.path) === false) {
                        failed.push(`${attachment.path} does not exist`);
                    }
                }
                else if (attachment.stream) {
                    if (!attachment.stream.readable) {
                        failed.push('attachment stream is not readable');
                    }
                }
                else if (!attachment.data) {
                    failed.push('attachment has no data associated with it');
                }
            });
            return {
                isValid: failed.length === 0,
                validationError: failed.join(', '),
            };
        }
        return { isValid: true, validationError: undefined };
    }
    /**
     * @public
     * @deprecated does not conform to the `errback` style followed by the rest of the library, and will be removed in the next major version. use `checkValidity` instead.
     * @param {function(isValid: boolean, invalidReason: (string | undefined)): void} callback .
     * @returns {void}
     */
    valid(callback) {
        const { isValid, validationError } = this.checkValidity();
        callback(isValid, validationError);
    }
    /**
     * @public
     * @returns {MessageStream} a stream of the current message
     */
    stream() {
        return new MessageStream(this);
    }
    /**
     * @public
     * @param {function(Error, string): void} callback the function to call with the error and buffer
     * @returns {void}
     */
    read(callback) {
        let buffer = '';
        const str = this.stream();
        str.on('data', (data) => (buffer += data));
        str.on('end', (err) => callback(err, buffer));
        str.on('error', (err) => callback(err, buffer));
    }
    readAsync() {
        return new Promise((resolve, reject) => {
            this.read((err, buffer) => {
                if (err != null) {
                    reject(err);
                }
                else {
                    resolve(buffer);
                }
            });
        });
    }
}
class MessageStream extends Stream {
    /**
     * @param {Message} message the message to stream
     */
    constructor(message) {
        super();
        this.message = message;
        this.readable = true;
        this.paused = false;
        this.buffer = Buffer.alloc(MIMECHUNK * 24 * 7);
        this.bufferIndex = 0;
        /**
         * @param {string} [data] the data to output
         * @param {Function} [callback] the function
         * @param {any[]} [args] array of arguments to pass to the callback
         * @returns {void}
         */
        const output = (data) => {
            // can we buffer the data?
            if (this.buffer != null) {
                const bytes = Buffer.byteLength(data);
                if (bytes + this.bufferIndex < this.buffer.length) {
                    this.buffer.write(data, this.bufferIndex);
                    this.bufferIndex += bytes;
                }
                // we can't buffer the data, so ship it out!
                else if (bytes > this.buffer.length) {
                    if (this.bufferIndex) {
                        this.emit('data', this.buffer.toString('utf-8', 0, this.bufferIndex));
                        this.bufferIndex = 0;
                    }
                    const loops = Math.ceil(data.length / this.buffer.length);
                    let loop = 0;
                    while (loop < loops) {
                        this.emit('data', data.substring(this.buffer.length * loop, this.buffer.length * (loop + 1)));
                        loop++;
                    }
                } // we need to clean out the buffer, it is getting full
                else {
                    if (!this.paused) {
                        this.emit('data', this.buffer.toString('utf-8', 0, this.bufferIndex));
                        this.buffer.write(data, 0);
                        this.bufferIndex = bytes;
                    }
                    else {
                        // we can't empty out the buffer, so let's wait till we resume before adding to it
                        this.once('resume', () => output(data));
                    }
                }
            }
        };
        /**
         * @param {MessageAttachment} [attachment] the attachment whose headers you would like to output
         * @returns {void}
         */
        const outputAttachmentHeaders = (attachment) => {
            let data = [];
            const headers = {
                'content-type': attachment.type +
                    (attachment.charset ? `; charset=${attachment.charset}` : '') +
                    (attachment.method ? `; method=${attachment.method}` : ''),
                'content-transfer-encoding': 'base64',
                'content-disposition': attachment.inline
                    ? 'inline'
                    : `attachment; filename="${mimeWordEncode(attachment.name)}"`,
            };
            // allow sender to override default headers
            if (attachment.headers != null) {
                for (const header in attachment.headers) {
                    headers[header.toLowerCase()] = attachment.headers[header];
                }
            }
            for (const header in headers) {
                data = data.concat([
                    convertDashDelimitedTextToSnakeCase(header),
                    ': ',
                    headers[header],
                    CRLF$1,
                ]);
            }
            output(data.concat([CRLF$1]).join(''));
        };
        /**
         * @param {string} data the data to output as base64
         * @param {function(): void} [callback] the function to call after output is finished
         * @returns {void}
         */
        const outputBase64 = (data, callback) => {
            const loops = Math.ceil(data.length / MIMECHUNK);
            let loop = 0;
            while (loop < loops) {
                output(data.substring(MIMECHUNK * loop, MIMECHUNK * (loop + 1)) + CRLF$1);
                loop++;
            }
            if (callback) {
                callback();
            }
        };
        const outputFile = (attachment, next) => {
            var _a;
            const chunk = MIME64CHUNK * 16;
            const buffer = Buffer.alloc(chunk);
            const inputEncoding = ((_a = attachment === null || attachment === void 0 ? void 0 : attachment.headers) === null || _a === void 0 ? void 0 : _a['content-transfer-encoding']) || 'base64';
            const encoding = inputEncoding === '7bit'
                ? 'ascii'
                : inputEncoding === '8bit'
                    ? 'binary'
                    : inputEncoding;
            /**
             * @param {Error} err the error to emit
             * @param {number} fd the file descriptor
             * @returns {void}
             */
            const opened = (err, fd) => {
                if (err) {
                    this.emit('error', err);
                    return;
                }
                const readBytes = (err, bytes) => {
                    if (err || this.readable === false) {
                        this.emit('error', err || new Error('message stream was interrupted somehow!'));
                        return;
                    }
                    // guaranteed to be encoded without padding unless it is our last read
                    outputBase64(buffer.toString(encoding, 0, bytes), () => {
                        if (bytes == chunk) {
                            // we read a full chunk, there might be more
                            read(fd, buffer, 0, chunk, null, readBytes);
                        } // that was the last chunk, we are done reading the file
                        else {
                            this.removeListener('error', closeSync);
                            close(fd, next);
                        }
                    });
                };
                read(fd, buffer, 0, chunk, null, readBytes);
                this.once('error', closeSync);
            };
            open(attachment.path, 'r', opened);
        };
        /**
         * @param {MessageAttachment} attachment the metadata to use as headers
         * @param {function(): void} callback the function to call after output is finished
         * @returns {void}
         */
        const outputStream = (attachment, callback) => {
            const { stream } = attachment;
            if (stream === null || stream === void 0 ? void 0 : stream.readable) {
                let previous = Buffer.alloc(0);
                stream.resume();
                stream.on('end', () => {
                    outputBase64(previous.toString('base64'), callback);
                    this.removeListener('pause', stream.pause);
                    this.removeListener('resume', stream.resume);
                    this.removeListener('error', stream.resume);
                });
                stream.on('data', (buff) => {
                    // do we have bytes from a previous stream data event?
                    let buffer = Buffer.isBuffer(buff) ? buff : Buffer.from(buff);
                    if (previous.byteLength > 0) {
                        buffer = Buffer.concat([previous, buffer]);
                    }
                    const padded = buffer.length % MIME64CHUNK;
                    previous = Buffer.alloc(padded);
                    // encode as much of the buffer to base64 without empty bytes
                    if (padded > 0) {
                        // copy dangling bytes into previous buffer
                        buffer.copy(previous, 0, buffer.length - padded);
                    }
                    outputBase64(buffer.toString('base64', 0, buffer.length - padded));
                });
                this.on('pause', stream.pause);
                this.on('resume', stream.resume);
                this.on('error', stream.resume);
            }
            else {
                this.emit('error', { message: 'stream not readable' });
            }
        };
        const outputAttachment = (attachment, callback) => {
            const build = attachment.path
                ? outputFile
                : attachment.stream
                    ? outputStream
                    : outputData;
            outputAttachmentHeaders(attachment);
            build(attachment, callback);
        };
        /**
         * @param {string} boundary the boundary text between outputs
         * @param {MessageAttachment[]} list the list of potential messages to output
         * @param {number} index the index of the list item to output
         * @param {function(): void} callback the function to call if index is greater than upper bound
         * @returns {void}
         */
        const outputMessage = (boundary, list, index, callback) => {
            if (index < list.length) {
                output(`--${boundary}${CRLF$1}`);
                if (list[index].related) {
                    outputRelated(list[index], () => outputMessage(boundary, list, index + 1, callback));
                }
                else {
                    outputAttachment(list[index], () => outputMessage(boundary, list, index + 1, callback));
                }
            }
            else {
                output(`${CRLF$1}--${boundary}--${CRLF$1}${CRLF$1}`);
                callback();
            }
        };
        const outputMixed = () => {
            const boundary = generateBoundary();
            output(`Content-Type: multipart/mixed; boundary="${boundary}"${CRLF$1}${CRLF$1}--${boundary}${CRLF$1}`);
            if (this.message.alternative == null) {
                outputText(this.message);
                outputMessage(boundary, this.message.attachments, 0, close$1);
            }
            else {
                outputAlternative(
                // typescript bug; should narrow to { alternative: MessageAttachment }
                this.message, () => outputMessage(boundary, this.message.attachments, 0, close$1));
            }
        };
        /**
         * @param {MessageAttachment} attachment the metadata to use as headers
         * @param {function(): void} callback the function to call after output is finished
         * @returns {void}
         */
        const outputData = (attachment, callback) => {
            var _a, _b;
            outputBase64(attachment.encoded
                ? (_a = attachment.data) !== null && _a !== void 0 ? _a : ''
                : Buffer.from((_b = attachment.data) !== null && _b !== void 0 ? _b : '').toString('base64'), callback);
        };
        /**
         * @param {Message} message the message to output
         * @returns {void}
         */
        const outputText = (message) => {
            let data = [];
            data = data.concat([
                'Content-Type:',
                message.content,
                CRLF$1,
                'Content-Transfer-Encoding: 7bit',
                CRLF$1,
            ]);
            data = data.concat(['Content-Disposition: inline', CRLF$1, CRLF$1]);
            data = data.concat([message.text || '', CRLF$1, CRLF$1]);
            output(data.join(''));
        };
        /**
         * @param {MessageAttachment} message the message to output
         * @param {function(): void} callback the function to call after output is finished
         * @returns {void}
         */
        const outputRelated = (message, callback) => {
            const boundary = generateBoundary();
            output(`Content-Type: multipart/related; boundary="${boundary}"${CRLF$1}${CRLF$1}--${boundary}${CRLF$1}`);
            outputAttachment(message, () => {
                var _a;
                outputMessage(boundary, (_a = message.related) !== null && _a !== void 0 ? _a : [], 0, () => {
                    output(`${CRLF$1}--${boundary}--${CRLF$1}${CRLF$1}`);
                    callback();
                });
            });
        };
        /**
         * @param {Message} message the message to output
         * @param {function(): void} callback the function to call after output is finished
         * @returns {void}
         */
        const outputAlternative = (message, callback) => {
            const boundary = generateBoundary();
            output(`Content-Type: multipart/alternative; boundary="${boundary}"${CRLF$1}${CRLF$1}--${boundary}${CRLF$1}`);
            outputText(message);
            output(`--${boundary}${CRLF$1}`);
            /**
             * @returns {void}
             */
            const finish = () => {
                output([CRLF$1, '--', boundary, '--', CRLF$1, CRLF$1].join(''));
                callback();
            };
            if (message.alternative.related) {
                outputRelated(message.alternative, finish);
            }
            else {
                outputAttachment(message.alternative, finish);
            }
        };
        const close$1 = (err) => {
            var _a, _b;
            if (err) {
                this.emit('error', err);
            }
            else {
                this.emit('data', (_b = (_a = this.buffer) === null || _a === void 0 ? void 0 : _a.toString('utf-8', 0, this.bufferIndex)) !== null && _b !== void 0 ? _b : '');
                this.emit('end');
            }
            this.buffer = null;
            this.bufferIndex = 0;
            this.readable = false;
            this.removeAllListeners('resume');
            this.removeAllListeners('pause');
            this.removeAllListeners('error');
            this.removeAllListeners('data');
            this.removeAllListeners('end');
        };
        /**
         * @returns {void}
         */
        const outputHeaderData = () => {
            if (this.message.attachments.length || this.message.alternative) {
                output(`MIME-Version: 1.0${CRLF$1}`);
                outputMixed();
            } // you only have a text message!
            else {
                outputText(this.message);
                close$1();
            }
        };
        /**
         * @returns {void}
         */
        const outputHeader = () => {
            let data = [];
            for (const header in this.message.header) {
                // do not output BCC in the headers (regex) nor custom Object.prototype functions...
                if (!/bcc/i.test(header) &&
                    Object.prototype.hasOwnProperty.call(this.message.header, header)) {
                    data = data.concat([
                        convertDashDelimitedTextToSnakeCase(header),
                        ': ',
                        this.message.header[header],
                        CRLF$1,
                    ]);
                }
            }
            output(data.join(''));
            outputHeaderData();
        };
        this.once('destroy', close$1);
        process.nextTick(outputHeader);
    }
    /**
     * @public
     * pause the stream
     * @returns {void}
     */
    pause() {
        this.paused = true;
        this.emit('pause');
    }
    /**
     * @public
     * resume the stream
     * @returns {void}
     */
    resume() {
        this.paused = false;
        this.emit('resume');
    }
    /**
     * @public
     * destroy the stream
     * @returns {void}
     */
    destroy() {
        this.emit('destroy', this.bufferIndex > 0 ? { message: 'message stream destroyed' } : null);
    }
    /**
     * @public
     * destroy the stream at first opportunity
     * @returns {void}
     */
    destroySoon() {
        this.emit('destroy');
    }
}

/**
 * @readonly
 * @enum
 */
const SMTPErrorStates = {
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
};
class SMTPError extends Error {
    /**
     * @protected
     * @param {string} message error message
     */
    constructor(message) {
        super(message);
        this.code = null;
        this.smtp = null;
        this.previous = null;
    }
    /**
     *
     * @param {string} message error message
     * @param {number} code smtp error state
     * @param {Error | null} error previous error
     * @param {unknown} smtp arbitrary data
     * @returns {SMTPError} error
     */
    static create(message, code, error, smtp) {
        const msg = (error === null || error === void 0 ? void 0 : error.message) ? `${message} (${error.message})` : message;
        const err = new SMTPError(msg);
        err.code = code;
        err.smtp = smtp;
        if (error) {
            err.previous = error;
        }
        return err;
    }
}

class SMTPResponseMonitor {
    constructor(stream, timeout, onerror) {
        let buffer = '';
        const notify = () => {
            var _a, _b;
            if (buffer.length) {
                // parse buffer for response codes
                const line = buffer.replace('\r', '');
                if (!((_b = (_a = line
                    .trim()
                    .split(/\n/)
                    .pop()) === null || _a === void 0 ? void 0 : _a.match(/^(\d{3})\s/)) !== null && _b !== void 0 ? _b : false)) {
                    return;
                }
                const match = line ? line.match(/(\d+)\s?(.*)/) : null;
                const data = match !== null
                    ? { code: match[1], message: match[2], data: line }
                    : { code: -1, data: line };
                stream.emit('response', null, data);
                buffer = '';
            }
        };
        const error = (err) => {
            stream.emit('response', SMTPError.create('connection encountered an error', SMTPErrorStates.ERROR, err));
        };
        const timedout = (err) => {
            stream.end();
            stream.emit('response', SMTPError.create('timedout while connecting to smtp server', SMTPErrorStates.TIMEDOUT, err));
        };
        const watch = (data) => {
            if (data !== null) {
                buffer += data.toString();
                notify();
            }
        };
        const close = (err) => {
            stream.emit('response', SMTPError.create('connection has closed', SMTPErrorStates.CONNECTIONCLOSED, err));
        };
        const end = (err) => {
            stream.emit('response', SMTPError.create('connection has ended', SMTPErrorStates.CONNECTIONENDED, err));
        };
        this.stop = (err) => {
            stream.removeAllListeners('response');
            stream.removeListener('data', watch);
            stream.removeListener('end', end);
            stream.removeListener('close', close);
            stream.removeListener('error', error);
            if (err != null && typeof onerror === 'function') {
                onerror(err);
            }
        };
        stream.on('data', watch);
        stream.on('end', end);
        stream.on('close', close);
        stream.on('error', error);
        stream.setTimeout(timeout, timedout);
    }
}

/**
 * @readonly
 * @enum
 */
const AUTH_METHODS = {
    PLAIN: 'PLAIN',
    'CRAM-MD5': 'CRAM-MD5',
    LOGIN: 'LOGIN',
    XOAUTH2: 'XOAUTH2',
};
/**
 * @readonly
 * @enum
 */
const SMTPState = {
    NOTCONNECTED: 0,
    CONNECTING: 1,
    CONNECTED: 2,
};
const DEFAULT_TIMEOUT = 5000;
const SMTP_PORT = 25;
const SMTP_SSL_PORT = 465;
const SMTP_TLS_PORT = 587;
const CRLF = '\r\n';
const GREYLIST_DELAY = 300;
let DEBUG = 0;
/**
 * @param {...any[]} args the message(s) to log
 * @returns {void}
 */
const log = (...args) => {
    if (DEBUG === 1) {
        args.forEach((d) => console.log(typeof d === 'object'
            ? d instanceof Error
                ? d.message
                : JSON.stringify(d)
            : d));
    }
};
/**
 * @param {function(...any[]): void} callback the function to call
 * @param {...any[]} args the arguments to apply to the function
 * @returns {void}
 */
const caller = (callback, ...args) => {
    if (typeof callback === 'function') {
        callback(...args);
    }
};
class SMTPConnection extends EventEmitter {
    /**
     * SMTP class written using python's (2.7) smtplib.py as a base.
     *
     * To target a Message Transfer Agent (MTA), omit all options.
     *
     * NOTE: `host` is trimmed before being used to establish a connection; however, the original untrimmed value will still be visible in configuration.
     */
    constructor({ timeout, host, user, password, domain, port, ssl, tls, logger, authentication, } = {}) {
        var _a;
        super();
        this.timeout = DEFAULT_TIMEOUT;
        this.log = log;
        this.authentication = [
            AUTH_METHODS['CRAM-MD5'],
            AUTH_METHODS.LOGIN,
            AUTH_METHODS.PLAIN,
            AUTH_METHODS.XOAUTH2,
        ];
        this._state = SMTPState.NOTCONNECTED;
        this._secure = false;
        this.loggedin = false;
        this.sock = null;
        this.features = null;
        this.monitor = null;
        this.domain = hostname();
        this.host = 'localhost';
        this.ssl = false;
        this.tls = false;
        this.greylistResponseTracker = new WeakSet();
        if (Array.isArray(authentication)) {
            this.authentication = authentication;
        }
        if (typeof timeout === 'number') {
            this.timeout = timeout;
        }
        if (typeof domain === 'string') {
            this.domain = domain;
        }
        if (typeof host === 'string') {
            this.host = host;
        }
        if (ssl != null &&
            (typeof ssl === 'boolean' ||
                (typeof ssl === 'object' && Array.isArray(ssl) === false))) {
            this.ssl = ssl;
        }
        if (tls != null &&
            (typeof tls === 'boolean' ||
                (typeof tls === 'object' && Array.isArray(tls) === false))) {
            this.tls = tls;
        }
        this.port = port || (ssl ? SMTP_SSL_PORT : tls ? SMTP_TLS_PORT : SMTP_PORT);
        this.loggedin = user && password ? false : true;
        if (!user && ((_a = password === null || password === void 0 ? void 0 : password.length) !== null && _a !== void 0 ? _a : 0) > 0) {
            throw new Error('`password` cannot be set without `user`');
        }
        // keep these strings hidden when quicky debugging/logging
        this.user = () => user;
        this.password = () => password;
        if (typeof logger === 'function') {
            this.log = log;
        }
    }
    /**
     * @public
     * @param {0 | 1} level -
     * @returns {void}
     */
    debug(level) {
        DEBUG = level;
    }
    /**
     * @public
     * @returns {SMTPState} the current state
     */
    state() {
        return this._state;
    }
    /**
     * @public
     * @returns {boolean} whether or not the instance is authorized
     */
    authorized() {
        return this.loggedin;
    }
    /**
     * Establish an SMTP connection.
     *
     * NOTE: `host` is trimmed before being used to establish a connection; however, the original untrimmed value will still be visible in configuration.
     *
     * @public
     * @param {function(...any[]): void} callback function to call after response
     * @param {number} [port] the port to use for the connection
     * @param {string} [host] the hostname to use for the connection
     * @param {ConnectOptions} [options={}] the options
     * @returns {void}
     */
    connect(callback, port = this.port, host = this.host, options = {}) {
        this.port = port;
        this.host = host;
        this.ssl = options.ssl || this.ssl;
        if (this._state !== SMTPState.NOTCONNECTED) {
            this.quit(() => this.connect(callback, port, host, options));
        }
        /**
         * @returns {void}
         */
        const connected = () => {
            this.log(`connected: ${this.host}:${this.port}`);
            if (this.ssl && !this.tls) {
                // if key/ca/cert was passed in, check if connection is authorized
                if (typeof this.ssl !== 'boolean' &&
                    this.sock instanceof TLSSocket &&
                    !this.sock.authorized) {
                    this.close(true);
                    caller(callback, SMTPError.create('could not establish an ssl connection', SMTPErrorStates.CONNECTIONAUTH));
                }
                else {
                    this._secure = true;
                }
            }
        };
        /**
         * @param {Error} err err
         * @returns {void}
         */
        const connectedErrBack = (err) => {
            if (!err) {
                connected();
            }
            else {
                this.close(true);
                this.log(err);
                caller(callback, SMTPError.create('could not connect', SMTPErrorStates.COULDNOTCONNECT, err));
            }
        };
        const response = (err, msg) => {
            if (err) {
                if (this._state === SMTPState.NOTCONNECTED && !this.sock) {
                    return;
                }
                this.close(true);
                caller(callback, err);
            }
            else if (msg.code == '220') {
                this.log(msg.data);
                // might happen first, so no need to wait on connected()
                this._state = SMTPState.CONNECTED;
                caller(callback, null, msg.data);
            }
            else {
                this.log(`response (data): ${msg.data}`);
                this.quit(() => {
                    caller(callback, SMTPError.create('bad response on connection', SMTPErrorStates.BADRESPONSE, err, msg.data));
                });
            }
        };
        this._state = SMTPState.CONNECTING;
        this.log(`connecting: ${this.host}:${this.port}`);
        if (this.ssl) {
            this.sock = connect(this.port, this.host.trim(), typeof this.ssl === 'object' ? this.ssl : {}, connected);
        }
        else {
            this.sock = new Socket();
            this.sock.connect(this.port, this.host.trim(), connectedErrBack);
        }
        this.monitor = new SMTPResponseMonitor(this.sock, this.timeout, () => this.close(true));
        this.sock.once('response', response);
        this.sock.once('error', response); // the socket could reset or throw, so let's handle it and let the user know
    }
    /**
     * @public
     * @param {string} str the string to send
     * @param {function(...any[]): void} callback function to call after response
     * @returns {void}
     */
    send(str, callback) {
        if (this.sock != null && this._state === SMTPState.CONNECTED) {
            this.log(str);
            this.sock.once('response', (err, msg) => {
                if (err) {
                    caller(callback, err);
                }
                else {
                    this.log(msg.data);
                    caller(callback, null, msg);
                }
            });
            if (this.sock.writable) {
                this.sock.write(str);
            }
        }
        else {
            this.close(true);
            caller(callback, SMTPError.create('no connection has been established', SMTPErrorStates.NOCONNECTION));
        }
    }
    /**
     * @public
     * @param {string} cmd command to issue
     * @param {function(...any[]): void} callback function to call after response
     * @param {(number[] | number)} [codes=[250]] array codes
     * @returns {void}
     */
    command(cmd, callback, codes = [250]) {
        const codesArray = Array.isArray(codes)
            ? codes
            : typeof codes === 'number'
                ? [codes]
                : [250];
        const response = (err, msg) => {
            if (err) {
                caller(callback, err);
            }
            else {
                const code = Number(msg.code);
                if (codesArray.indexOf(code) !== -1) {
                    caller(callback, err, msg.data, msg.message);
                }
                else if ((code === 450 || code === 451) &&
                    msg.message.toLowerCase().includes('greylist') &&
                    this.greylistResponseTracker.has(response) === false) {
                    this.greylistResponseTracker.add(response);
                    setTimeout(() => {
                        this.send(cmd + CRLF, response);
                    }, GREYLIST_DELAY);
                }
                else {
                    const suffix = msg.message ? `: ${msg.message}` : '';
                    const errorMessage = `bad response on command '${cmd.split(' ')[0]}'${suffix}`;
                    caller(callback, SMTPError.create(errorMessage, SMTPErrorStates.BADRESPONSE, null, msg.data));
                }
            }
        };
        this.greylistResponseTracker.delete(response);
        this.send(cmd + CRLF, response);
    }
    /**
     * @public
     * @description SMTP 'helo' command.
     *
     * Hostname to send for self command defaults to the FQDN of the local
     * host.
     *
     * As this command was deprecated by rfc2821, it should only be used for compatibility with non-compliant servers.
     * @see https://tools.ietf.org/html/rfc2821#appendix-F.3
     *
     * @param {function(...any[]): void} callback function to call after response
     * @param {string} domain the domain to associate with the 'helo' request
     * @returns {void}
     */
    helo(callback, domain) {
        this.command(`helo ${domain || this.domain}`, (err, data) => {
            if (err) {
                caller(callback, err);
            }
            else {
                this.parse_smtp_features(data);
                caller(callback, err, data);
            }
        });
    }
    /**
     * @public
     * @param {function(...any[]): void} callback function to call after response
     * @returns {void}
     */
    starttls(callback) {
        const response = (err, msg) => {
            if (this.sock == null) {
                throw new Error('null socket');
            }
            if (err) {
                err.message += ' while establishing a starttls session';
                caller(callback, err);
            }
            else {
                const secureContext = createSecureContext(typeof this.tls === 'object' ? this.tls : {});
                const secureSocket = new TLSSocket(this.sock, { secureContext });
                secureSocket.on('error', (err) => {
                    this.close(true);
                    caller(callback, err);
                });
                this._secure = true;
                this.sock = secureSocket;
                new SMTPResponseMonitor(this.sock, this.timeout, () => this.close(true));
                caller(callback, msg.data);
            }
        };
        this.command('starttls', response, [220]);
    }
    /**
     * @public
     * @param {string} data the string to parse for features
     * @returns {void}
     */
    parse_smtp_features(data) {
        //  According to RFC1869 some (badly written)
        //  MTA's will disconnect on an ehlo. Toss an exception if
        //  that happens -ddm
        data.split('\n').forEach((ext) => {
            const parse = ext.match(/^(?:\d+[-=]?)\s*?([^\s]+)(?:\s+(.*)\s*?)?$/);
            // To be able to communicate with as many SMTP servers as possible,
            // we have to take the old-style auth advertisement into account,
            // because:
            // 1) Else our SMTP feature parser gets confused.
            // 2) There are some servers that only advertise the auth methods we
            // support using the old style.
            if (parse != null && this.features != null) {
                // RFC 1869 requires a space between ehlo keyword and parameters.
                // It's actually stricter, in that only spaces are allowed between
                // parameters, but were not going to check for that here.  Note
                // that the space isn't present if there are no parameters.
                this.features[parse[1].toLowerCase()] = parse[2] || true;
            }
        });
    }
    /**
     * @public
     * @param {function(...any[]): void} callback function to call after response
     * @param {string} domain the domain to associate with the 'ehlo' request
     * @returns {void}
     */
    ehlo(callback, domain) {
        this.features = {};
        this.command(`ehlo ${domain || this.domain}`, (err, data) => {
            if (err) {
                caller(callback, err);
            }
            else {
                this.parse_smtp_features(data);
                if (this.tls && !this._secure) {
                    this.starttls(() => this.ehlo(callback, domain));
                }
                else {
                    caller(callback, err, data);
                }
            }
        });
    }
    /**
     * @public
     * @param {string} opt the features keyname to check
     * @returns {boolean} whether the extension exists
     */
    has_extn(opt) {
        var _a;
        return ((_a = this.features) !== null && _a !== void 0 ? _a : {})[opt.toLowerCase()] === undefined;
    }
    /**
     * @public
     * @description SMTP 'help' command, returns text from the server
     * @param {function(...any[]): void} callback function to call after response
     * @param {string} domain the domain to associate with the 'help' request
     * @returns {void}
     */
    help(callback, domain) {
        this.command(domain ? `help ${domain}` : 'help', callback, [211, 214]);
    }
    /**
     * @public
     * @param {function(...any[]): void} callback function to call after response
     * @returns {void}
     */
    rset(callback) {
        this.command('rset', callback);
    }
    /**
     * @public
     * @param {function(...any[]): void} callback function to call after response
     * @returns {void}
     */
    noop(callback) {
        this.send('noop', callback);
    }
    /**
     * @public
     * @param {function(...any[]): void} callback function to call after response
     * @param {string} from the sender
     * @returns {void}
     */
    mail(callback, from) {
        this.command(`mail FROM:${from}`, callback);
    }
    /**
     * @public
     * @param {function(...any[]): void} callback function to call after response
     * @param {string} to the receiver
     * @returns {void}
     */
    rcpt(callback, to) {
        this.command(`RCPT TO:${to}`, callback, [250, 251]);
    }
    /**
     * @public
     * @param {function(...any[]): void} callback function to call after response
     * @returns {void}
     */
    data(callback) {
        this.command('data', callback, [354]);
    }
    /**
     * @public
     * @param {function(...any[]): void} callback function to call after response
     * @returns {void}
     */
    data_end(callback) {
        this.command(`${CRLF}.`, callback);
    }
    /**
     * @public
     * @param {string} data the message to send
     * @returns {void}
     */
    message(data) {
        var _a, _b;
        this.log(data);
        (_b = (_a = this.sock) === null || _a === void 0 ? void 0 : _a.write(data)) !== null && _b !== void 0 ? _b : this.log('no socket to write to');
    }
    /**
     * @public
     * @description SMTP 'verify' command -- checks for address validity.
     * @param {string} address the address to validate
     * @param {function(...any[]): void} callback function to call after response
     * @returns {void}
     */
    verify(address, callback) {
        this.command(`vrfy ${address}`, callback, [250, 251, 252]);
    }
    /**
     * @public
     * @description SMTP 'expn' command -- expands a mailing list.
     * @param {string} address the mailing list to expand
     * @param {function(...any[]): void} callback function to call after response
     * @returns {void}
     */
    expn(address, callback) {
        this.command(`expn ${address}`, callback);
    }
    /**
     * @public
     * @description Calls this.ehlo() and, if an error occurs, this.helo().
     *
     * If there has been no previous EHLO or HELO command self session, self
     * method tries ESMTP EHLO first.
     *
     * @param {function(...any[]): void} callback function to call after response
     * @param {string} [domain] the domain to associate with the command
     * @returns {void}
     */
    ehlo_or_helo_if_needed(callback, domain) {
        // is this code callable...?
        if (!this.features) {
            const response = (err, data) => caller(callback, err, data);
            this.ehlo((err, data) => {
                if (err) {
                    this.helo(response, domain);
                }
                else {
                    caller(callback, err, data);
                }
            }, domain);
        }
    }
    /**
     * @public
     *
     * Log in on an SMTP server that requires authentication.
     *
     * If there has been no previous EHLO or HELO command self session, self
     * method tries ESMTP EHLO first.
     *
     * This method will return normally if the authentication was successful.
     *
     * @param {function(...any[]): void} callback function to call after response
     * @param {string} [user] the username to authenticate with
     * @param {string} [password] the password for the authentication
     * @param {{ method: string, domain: string }} [options] login options
     * @returns {void}
     */
    login(callback, user, password, options = {}) {
        var _a, _b;
        const login = {
            user: user ? () => user : this.user,
            password: password ? () => password : this.password,
            method: (_b = (_a = options === null || options === void 0 ? void 0 : options.method) === null || _a === void 0 ? void 0 : _a.toUpperCase()) !== null && _b !== void 0 ? _b : '',
        };
        const domain = (options === null || options === void 0 ? void 0 : options.domain) || this.domain;
        const initiate = (err, data) => {
            var _a;
            if (err) {
                caller(callback, err);
                return;
            }
            let method = null;
            /**
             * @param {string} challenge challenge
             * @returns {string} base64 cram hash
             */
            const encodeCramMd5 = (challenge) => {
                const hmac = createHmac('md5', login.password());
                hmac.update(Buffer.from(challenge, 'base64').toString('ascii'));
                return Buffer.from(`${login.user()} ${hmac.digest('hex')}`).toString('base64');
            };
            /**
             * @returns {string} base64 login/password
             */
            const encodePlain = () => Buffer.from(`\u0000${login.user()}\u0000${login.password()}`).toString('base64');
            /**
             * @see https://developers.google.com/gmail/xoauth2_protocol
             * @returns {string} base64 xoauth2 auth token
             */
            const encodeXoauth2 = () => Buffer.from(`user=${login.user()}\u0001auth=Bearer ${login.password()}\u0001\u0001`).toString('base64');
            // List of authentication methods we support: from preferred to
            // less preferred methods.
            if (!method) {
                const preferred = this.authentication;
                let auth = '';
                if (typeof ((_a = this.features) === null || _a === void 0 ? void 0 : _a['auth']) === 'string') {
                    auth = this.features['auth'];
                }
                for (let i = 0; i < preferred.length; i++) {
                    if (auth.includes(preferred[i])) {
                        method = preferred[i];
                        break;
                    }
                }
            }
            /**
             * handle bad responses from command differently
             * @param {Error} err err
             * @param {unknown} data data
             * @returns {void}
             */
            const failed = (err, data) => {
                this.loggedin = false;
                this.close(); // if auth is bad, close the connection, it won't get better by itself
                caller(callback, SMTPError.create('authorization.failed', SMTPErrorStates.AUTHFAILED, err, data));
            };
            /**
             * @param {Error} err err
             * @param {unknown} data data
             * @returns {void}
             */
            const response = (err, data) => {
                if (err) {
                    failed(err, data);
                }
                else {
                    this.loggedin = true;
                    caller(callback, err, data);
                }
            };
            /**
             * @param {Error} err err
             * @param {unknown} data data
             * @param {string} msg msg
             * @returns {void}
             */
            const attempt = (err, data, msg) => {
                if (err) {
                    failed(err, data);
                }
                else {
                    if (method === AUTH_METHODS['CRAM-MD5']) {
                        this.command(encodeCramMd5(msg), response, [235, 503]);
                    }
                    else if (method === AUTH_METHODS.LOGIN) {
                        this.command(Buffer.from(login.password()).toString('base64'), response, [235, 503]);
                    }
                }
            };
            /**
             * @param {Error} err err
             * @param {unknown} data data
             * @param {string} msg msg
             * @returns {void}
             */
            const attemptUser = (err, data) => {
                if (err) {
                    failed(err, data);
                }
                else {
                    if (method === AUTH_METHODS.LOGIN) {
                        this.command(Buffer.from(login.user()).toString('base64'), attempt, [334]);
                    }
                }
            };
            switch (method) {
                case AUTH_METHODS['CRAM-MD5']:
                    this.command(`AUTH  ${AUTH_METHODS['CRAM-MD5']}`, attempt, [334]);
                    break;
                case AUTH_METHODS.LOGIN:
                    this.command(`AUTH ${AUTH_METHODS.LOGIN}`, attemptUser, [334]);
                    break;
                case AUTH_METHODS.PLAIN:
                    this.command(`AUTH ${AUTH_METHODS.PLAIN} ${encodePlain()}`, response, [235, 503]);
                    break;
                case AUTH_METHODS.XOAUTH2:
                    this.command(`AUTH ${AUTH_METHODS.XOAUTH2} ${encodeXoauth2()}`, response, [235, 503]);
                    break;
                default:
                    caller(callback, SMTPError.create('no form of authorization supported', SMTPErrorStates.AUTHNOTSUPPORTED, null, data));
                    break;
            }
        };
        this.ehlo_or_helo_if_needed(initiate, domain);
    }
    /**
     * @public
     * @param {boolean} [force=false] whether or not to force destroy the connection
     * @returns {void}
     */
    close(force = false) {
        if (this.sock) {
            if (force) {
                this.log('smtp connection destroyed!');
                this.sock.destroy();
            }
            else {
                this.log('smtp connection closed.');
                this.sock.end();
            }
        }
        if (this.monitor) {
            this.monitor.stop();
            this.monitor = null;
        }
        this._state = SMTPState.NOTCONNECTED;
        this._secure = false;
        this.sock = null;
        this.features = null;
        this.loggedin = !(this.user() && this.password());
    }
    /**
     * @public
     * @param {function(...any[]): void} [callback] function to call after response
     * @returns {void}
     */
    quit(callback) {
        this.command('quit', (err, data) => {
            caller(callback, err, data);
            this.close();
        }, [221, 250]);
    }
}

class SMTPClient {
    /**
     * Create a standard SMTP client backed by a self-managed SMTP connection.
     *
     * NOTE: `host` is trimmed before being used to establish a connection; however, the original untrimmed value will still be visible in configuration.
     *
     * @param {SMTPConnectionOptions} server smtp options
     */
    constructor(server) {
        this.queue = [];
        this.sending = false;
        this.ready = false;
        this.timer = null;
        this.smtp = new SMTPConnection(server);
    }
    /**
     * @public
     * @template {Message | MessageHeaders} T
     * @param {T} msg the message to send
     * @param {MessageCallback<T>} callback receiver for the error (if any) as well as the passed-in message / headers
     * @returns {void}
     */
    send(msg, callback) {
        const message = msg instanceof Message
            ? msg
            : this._canMakeMessage(msg)
                ? new Message(msg)
                : null;
        if (message == null) {
            callback(new Error('message is not a valid Message instance'), msg);
            return;
        }
        const { isValid, validationError } = message.checkValidity();
        if (isValid) {
            const stack = this.createMessageStack(message, callback);
            if (stack.to.length === 0) {
                return callback(new Error('No recipients found in message'), msg);
            }
            this.queue.push(stack);
            this._poll();
        }
        else {
            callback(new Error(validationError), msg);
        }
    }
    /**
     * @public
     * @template {Message | MessageHeaders} T
     * @param {T} msg the message to send
     * @returns {Promise<T>} a promise that resolves to the passed-in message / headers
     */
    sendAsync(msg) {
        return new Promise((resolve, reject) => {
            this.send(msg, (err, message) => {
                if (err != null) {
                    reject(err);
                }
                else {
                    // unfortunately, the conditional type doesn't reach here
                    // fortunately, we only return a `Message` when err is null, so this is safe
                    resolve(message);
                }
            });
        });
    }
    /**
     * @public
     * @description Converts a message to the raw object used by the internal stack.
     * @param {Message} message message to convert
     * @param {MessageCallback} callback errback
     * @returns {MessageStack} raw message object
     */
    createMessageStack(message, callback = function () {
        /* ø */
    }) {
        const [{ address: from }] = addressparser(message.header.from);
        const stack = {
            message,
            to: [],
            from,
            callback: callback.bind(this),
        };
        const { header: { to, cc, bcc, 'return-path': returnPath }, } = message;
        if ((typeof to === 'string' || Array.isArray(to)) && to.length > 0) {
            stack.to = addressparser(to);
        }
        if ((typeof cc === 'string' || Array.isArray(cc)) && cc.length > 0) {
            stack.to = stack.to.concat(addressparser(cc).filter((x) => stack.to.some((y) => y.address === x.address) === false));
        }
        if ((typeof bcc === 'string' || Array.isArray(bcc)) && bcc.length > 0) {
            stack.to = stack.to.concat(addressparser(bcc).filter((x) => stack.to.some((y) => y.address === x.address) === false));
        }
        if (typeof returnPath === 'string' && returnPath.length > 0) {
            const parsedReturnPath = addressparser(returnPath);
            if (parsedReturnPath.length > 0) {
                const [{ address: returnPathAddress }] = parsedReturnPath;
                stack.returnPath = returnPathAddress;
            }
        }
        return stack;
    }
    /**
     * @protected
     * @returns {void}
     */
    _poll() {
        if (this.timer != null) {
            clearTimeout(this.timer);
        }
        if (this.queue.length) {
            if (this.smtp.state() == SMTPState.NOTCONNECTED) {
                this._connect(this.queue[0]);
            }
            else if (this.smtp.state() == SMTPState.CONNECTED &&
                !this.sending &&
                this.ready) {
                this._sendmail(this.queue.shift());
            }
        }
        // wait around 1 seconds in case something does come in,
        // otherwise close out SMTP connection if still open
        else if (this.smtp.state() == SMTPState.CONNECTED) {
            this.timer = setTimeout(() => this.smtp.quit(), 1000);
        }
    }
    /**
     * @protected
     * @param {MessageStack} stack stack
     * @returns {void}
     */
    _connect(stack) {
        /**
         * @param {Error} err callback error
         * @returns {void}
         */
        const connect = (err) => {
            if (!err) {
                const begin = (err) => {
                    if (!err) {
                        this.ready = true;
                        this._poll();
                    }
                    else {
                        stack.callback(err, stack.message);
                        // clear out the queue so all callbacks can be called with the same error message
                        this.queue.shift();
                        this._poll();
                    }
                };
                if (!this.smtp.authorized()) {
                    this.smtp.login(begin);
                }
                else {
                    this.smtp.ehlo_or_helo_if_needed(begin);
                }
            }
            else {
                stack.callback(err, stack.message);
                // clear out the queue so all callbacks can be called with the same error message
                this.queue.shift();
                this._poll();
            }
        };
        this.ready = false;
        this.smtp.connect(connect);
    }
    /**
     * @protected
     * @param {MessageStack} msg message stack
     * @returns {boolean} can make message
     */
    _canMakeMessage(msg) {
        return (msg.from &&
            (msg.to || msg.cc || msg.bcc) &&
            (msg.text !== undefined || this._containsInlinedHtml(msg.attachment)));
    }
    /**
     * @protected
     * @param {MessageAttachment | MessageAttachment[]} attachment attachment
     * @returns {boolean} whether the attachment contains inlined html
     */
    _containsInlinedHtml(attachment) {
        if (Array.isArray(attachment)) {
            return attachment.some((att) => {
                return this._isAttachmentInlinedHtml(att);
            });
        }
        else {
            return this._isAttachmentInlinedHtml(attachment);
        }
    }
    /**
     * @protected
     * @param {MessageAttachment} attachment attachment
     * @returns {boolean} whether the attachment is inlined html
     */
    _isAttachmentInlinedHtml(attachment) {
        return (attachment &&
            (attachment.data || attachment.path) &&
            attachment.alternative === true);
    }
    /**
     * @protected
     * @param {MessageStack} stack stack
     * @param {function(MessageStack): void} next next
     * @returns {function(Error): void} callback
     */
    _sendsmtp(stack, next) {
        /**
         * @param {Error} [err] error
         * @returns {void}
         */
        return (err) => {
            if (!err && next) {
                next.apply(this, [stack]);
            }
            else {
                // if we snag on SMTP commands, call done, passing the error
                // but first reset SMTP state so queue can continue polling
                this.smtp.rset(() => this._senddone(err, stack));
            }
        };
    }
    /**
     * @protected
     * @param {MessageStack} stack stack
     * @returns {void}
     */
    _sendmail(stack) {
        const from = stack.returnPath || stack.from;
        this.sending = true;
        this.smtp.mail(this._sendsmtp(stack, this._sendrcpt), '<' + from + '>');
    }
    /**
     * @protected
     * @param {MessageStack} stack stack
     * @returns {void}
     */
    _sendrcpt(stack) {
        var _a;
        if (stack.to == null || typeof stack.to === 'string') {
            throw new TypeError('stack.to must be array');
        }
        const to = (_a = stack.to.shift()) === null || _a === void 0 ? void 0 : _a.address;
        this.smtp.rcpt(this._sendsmtp(stack, stack.to.length ? this._sendrcpt : this._senddata), `<${to}>`);
    }
    /**
     * @protected
     * @param {MessageStack} stack stack
     * @returns {void}
     */
    _senddata(stack) {
        this.smtp.data(this._sendsmtp(stack, this._sendmessage));
    }
    /**
     * @protected
     * @param {MessageStack} stack stack
     * @returns {void}
     */
    _sendmessage(stack) {
        const stream = stack.message.stream();
        stream.on('data', (data) => this.smtp.message(data));
        stream.on('end', () => {
            this.smtp.data_end(this._sendsmtp(stack, () => this._senddone(null, stack)));
        });
        // there is no way to cancel a message while in the DATA portion,
        // so we have to close the socket to prevent a bad email from going out
        stream.on('error', (err) => {
            this.smtp.close();
            this._senddone(err, stack);
        });
    }
    /**
     * @protected
     * @param {Error} err err
     * @param {MessageStack} stack stack
     * @returns {void}
     */
    _senddone(err, stack) {
        this.sending = false;
        stack.callback(err, stack.message);
        this._poll();
    }
}

export { AUTH_METHODS, BUFFERSIZE, DEFAULT_TIMEOUT, MIME64CHUNK, MIMECHUNK, Message, SMTPClient, SMTPConnection, SMTPError, SMTPErrorStates, SMTPResponseMonitor, SMTPState, addressparser, getRFC2822Date, getRFC2822DateUTC, isRFC2822Date, mimeEncode, mimeWordEncode };
//# sourceMappingURL=email.js.map
