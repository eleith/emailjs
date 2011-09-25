var SMTPError = require('./error');

function SMTPResponse(stream, timeout, onerror) 
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
		stream.emit('response', {code:SMTPError.ERROR, message:"connection encountered an error", error:err});
		destroy(err);
	},

   timedout = function(err)
   {
      stream.emit('response', {code:SMTPError.TIMEDOUT, message:"timedout while connecting to smtp server", error:err});
      destroy(err);
   },

	watch = function(data) 
	{
		var decoded = data.toString();
		var emit		= false;
		var code		= 0;

		buffer += decoded;
		notify();
	},

	close = function(err)
	{
		stream.emit('response', {code:SMTPError.CONNECTIONCLOSED, message:"connection has closed", error:err});
		destroy(err);
	},

	end = function(err)
	{
		stream.emit('response', {code:SMTPError.CONNECTIONENDED, message:"connection has ended", error:err});
      destroy(err);
	};

   destroy = function()
   {
   	stream.removeAllListeners('response');
		stream.removeListener('data', watch);
		stream.removeListener('end', end);
		stream.removeListener('close', close);
		stream.removeListener('error', error);

      if(typeof(onerror) == "function")
         onerror(err);
   };

	stream.on('data', watch);
	stream.on('end', end);
	stream.on('close', close);
	stream.on('error', error);
   stream.setTimeout(timeout, timedout);
}

exports.monitor = function(stream) 
{
	return new SMTPResponse(stream);
};
