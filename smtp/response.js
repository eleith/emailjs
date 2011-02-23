var SMTPError = require('./error');

function SMTPResponse(stream, timeout) 
{
	var buffer = '',
	
	notify = function()
	{
		if(buffer.length)
		{
			stream.emit('response', null, buffer.replace("\r", ''));
			buffer = '';
		}
	},

	error = function(err)
	{
		stream.emit('response', {code:SMTPError.ERROR, message:"connection encountered an error", error:err});
		end();
	},

	timedout = function(err)
	{
		stream.emit('response', {code:SMTPError.TIMEDOUT, message:"connection has timedout", error:err});
		end();
	},

	watch = function(data) 
	{
		var decoded = data.toString();
		var emit		= false;
		var code		= 0;
		var parsed	= decoded.match(/^(?:.*\n)?([^\n]+)\n\s*$/m);

		buffer += decoded;
		notify();
	},

	close = function(err)
	{
		if(buffer.length)
			notify();

		else
			stream.emit('response', {code:SMTPError.CONNECTIONCLOSED, message:"connection has closed", error:err});

		end();
	},

	end = function(err)
	{
		if(buffer.length)
			notify();

		else
			stream.emit('response', {code:SMTPError.CONNECTIONENDED, message:"connection has ended", error:err});
		
		stream.removeAllListeners('response');
		stream.removeListener('data', watch);
		stream.removeListener('end', end);
		stream.removeListener('close', close);
		stream.removeListener('error', error);
		stream.removeListener('timeout', timedout);
	};

	stream.on('data', watch);
	stream.on('end', end);
	stream.on('close', close);
	stream.on('timeout', timedout);
	stream.on('error', error);
}

exports.watch = function(stream) 
{
	return new SMTPResponse(stream);
};

exports.parse = function(line)
{
	var match = line ? line.match(/(\d+)\s?(.*)/) : null;
	return match ? {code:match[1], message:match[2]} : {};
}
