var SMTPError = require('./error');

var SMTPResponse = function(stream, timeout, onerror) 
{
  var buffer = '',

  notify = function()
  {
    if(buffer.length)
    {
      // parse buffer for response codes
      var line = buffer.replace("\r", '');
      var match = line ? line.match(/(\d+)\s?(.*)/) : null;

      stream.emit('response', null, match ? {code:match[1], message:match[2], data:line} : {code:-1, data:line});
      buffer = '';
    }
  },

  error = function(err)
  {
    stream.emit('response', SMTPError('connection encountered an error', SMTPError.ERROR, err));
  },

  timedout = function(err)
  {
    stream.emit('response', SMTPError('timedout while connecting to smtp server', SMTPError.TIMEDOUT, err));
  },

  watch = function(data)
  {
    //var data = stream.read();
    if (data !== null) {
      var decoded = data.toString();
      var emit		= false;
      var code		= 0;

      buffer += decoded;
      notify();
    }
  },

  close = function(err)
  {
    stream.emit('response', SMTPError('connection has closed', SMTPError.CONNECTIONCLOSED, err));
  },

  end = function(err)
  {
    stream.emit('response', SMTPError('connection has ended', SMTPError.CONNECTIONENDED, err));
  };

  this.stop = function(err) {
    stream.removeAllListeners('response');
    //stream.removeListener('readable', watch);
    stream.removeListener('data', watch);
    stream.removeListener('end', end);
    stream.removeListener('close', close);
    stream.removeListener('error', error);

    if(err && typeof(onerror) == "function")
      onerror(err);
  };

  //stream.on('readable', watch);
  stream.on('data', watch);
  stream.on('end', end);
  stream.on('close', close);
  stream.on('error', error);
  stream.setTimeout(timeout, timedout);
};

exports.monitor = function(stream, timeout, onerror) 
{
  return new SMTPResponse(stream, timeout, onerror);
};
