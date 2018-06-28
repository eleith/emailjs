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
module.exports = function(message, code, error, smtp) {
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

module.exports.COULDNOTCONNECT = 1;
module.exports.BADRESPONSE = 2;
module.exports.AUTHFAILED = 3;
module.exports.TIMEDOUT = 4;
module.exports.ERROR = 5;
module.exports.NOCONNECTION = 6;
module.exports.AUTHNOTSUPPORTED = 7;
module.exports.CONNECTIONCLOSED = 8;
module.exports.CONNECTIONENDED = 9;
module.exports.CONNECTIONAUTH = 10;
