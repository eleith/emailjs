class SMTPError extends Error {
	/**
	 * @param {string} message the error message
	 */
	constructor(message) {
		super(message);

		/**
		 * @type {number}
		 */
		this.code = null;

		/**
		 * @type {*}
		 */
		this.smtp = null;

		/**
		 * @type {Error}
		 */
		this.previous = null;
	}
}

/**
 * @param {string} message the error message
 * @param {number} code the error code
 * @param {Error} [error] an error object
 * @param {*} [smtp] smtp
 * @returns {SMTPError} an smtp error object
 */
export function makeSMTPError(message, code, error, smtp) {
	const err = new SMTPError(
		error != null && error.message ? `${message} (${error.message})` : message
	);

	err.code = code;
	err.smtp = smtp;

	if (error) {
		err.previous = error;
	}

	return err;
};

/**
 * @type {1}
 */
export const COULDNOTCONNECT = 1;
/**
 * @type {2}
 */
export const BADRESPONSE = 2;
/**
 * @type {3}
 */
export const AUTHFAILED = 3;
/**
 * @type {4}
 */
export const TIMEDOUT = 4;
/**
 * @type {5}
 */
export const ERROR = 5;
/**
 * @type {6}
 */
export const NOCONNECTION = 6;
/**
 * @type {7}
 */
export const AUTHNOTSUPPORTED = 7;
/**
 * @type {8}
 */
export const CONNECTIONCLOSED = 8;
/**
 * @type {9}
 */
export const CONNECTIONENDED = 9;
/**
 * @type {10}
 */
export const CONNECTIONAUTH = 10;
