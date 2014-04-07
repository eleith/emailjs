module.exports = function(message, code, error, smtp)
{
  var err = new Error(message);
  err.code = code;
  if(error)
    err.previous = error;
  err.smtp = smtp;

  return err;
};

module.exports.COULDNOTCONNECT =	1;
module.exports.BADRESPONSE = 2;
module.exports.AUTHFAILED = 3;
module.exports.TIMEDOUT = 4;
module.exports.ERROR = 5;
module.exports.NOCONNECTION = 6;
module.exports.AUTHNOTSUPPORTED = 7;
module.exports.CONNECTIONCLOSED = 8;
module.exports.CONNECTIONENDED = 9;
module.exports.CONNECTIONAUTH = 10;
