var stream 	= require('stream');
var util		= require('util');
var fs		= require('fs');
var os		= require('os');
var CRLF		= "\r\n";

var generate_boundary = function()
{
	var text 		= "";
	var possible 	= "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'()+_,-./:=?";

	for(var i=0; i < 69; i++)
		text += possible.charAt(Math.floor(Math.random() * possible.length));

	return text;
};

var Message = function(headers)
{
	this.attachments	= [];
	this.html			= null;
	this.header			= {"message-id":"<" + (new Date()).getTime() + "." + process.pid + "@" + os.hostname() +">"};
	this.content		= "text/plain; charset=utf-8";

	for(var header in headers)
	{
		// allow user to override default content-type to override charset or send a single non-text message
		if(/^content-type$/i.test(header))
		{
			this.content = headers[header];
		}
		else if(header == 'text')
		{
			this.text = headers[header];
		}
		else
		{
			// allow any headers the user wants to set??
			// if(/cc|bcc|to|from|reply-to|sender|subject|date|message-id/i.test(header))
			this.header[header.toLowerCase()] = headers[header];
		}
	}
};

Message.prototype = 
{

	attach: function(path, type, name)
	{
		this.attachments.push({path:path, type:type, name:name});
		return this;
	},

	attach_alternative: function(html, charset)
	{
		this.html = {message:html, charset:charset || "utf-8"};
		return this;
	},

	valid: function()
	{
		if(!this.header["from"])
			return false;

		if(!this.header["to"])
			return false;

		return true;
	},

	stream: function()
	{
		return new MessageStream(this);
	},

	read: function(callback)
	{
		var buffer = "";

		var capture = function(data)
		{
			buffer += data;
		};

		var output = function(err)
		{
			callback(err, buffer);
		};

		var str = this.stream();

		str.on('data', capture);
		str.on('end', output);
		str.on('error', output);
	}
};

var MessageStream = function(message)
{
	var self			= this;

	stream.Stream.call(self);

	self.message	= message;
	self.readable 	= true;
	self.resume		= null;
	self.paused		= false;
	self.stopped	= false;
	self.stream		= null;

	var output_process = function(next)
	{
		var check = function()
		{
			if(self.stopped)
				return;

			else if(self.paused)
				self.resume = next;

			else
				next();
		};

		process.nextTick(check);
	};

	var output_mixed = function()
	{
		var data 		= [];
		var boundary	= generate_boundary();

		self.emit('data', ["Content-Type: multipart/mixed; boundary=\"", boundary, "\"", CRLF, CRLF].join(""));
		output_process(function() { output_message(-1, boundary); });
	};

	var output_message = function(index, boundary)
	{
		var next = function()
		{
			output_process(function() { output_message(index + 1, boundary); });
		};

		if(index < 0)
		{
			self.emit('data', ["--", boundary, CRLF].join(""));

			if(self.message.html)
			{
				output_process(function() { output_alternatives(next); });
			}
			else
			{
				output_text(next);
			}
		}
		else if(index < self.message.attachments.length)
		{
			self.emit('data', ["--", boundary, CRLF].join(""));
			output_process(function() { output_attachment(self.message.attachments[index], next); });
		}
		else
		{
			self.emit('data', ["--", boundary, "--", CRLF, CRLF].join(""));
			self.emit('end');
		}
	};

	var output_alternatives = function(next)
	{
		var boundary	= generate_boundary();

		self.emit('data', ["Content-Type: multipart/alternative; boundary=\"", boundary, "\"", CRLF, CRLF].join(""));
		self.emit('data', ["--", boundary, CRLF].join(""));

		output_text(function(){});

		var data = ["--", boundary, CRLF];

		data = data.concat(["Content-Type:text/html; charset=", self.message.html.charset, CRLF, "Content-Transfer-Encoding: base64", CRLF]);
		data = data.concat(["Content-Disposition: inline", CRLF, CRLF]);
		data = data.concat([(new Buffer(self.message.html.message)).toString("base64"), CRLF, CRLF]);
		data = data.concat(["--", boundary, "--", CRLF, CRLF]);

		self.emit('data', data.join(""));
		next();
	};

	var output_attachment = function(attachment, next)
	{
		var data = ["Content-Type: ", attachment.type, CRLF, "Content-Transfer-Encoding: base64", CRLF];
		data		= data.concat(["Content-Disposition: attachment; filename=\"", attachment.name, "\"", CRLF, CRLF]);

		self.emit('data', data.join(""));
		
		var chunk	= 5700;
		var buffer 	= new Buffer(chunk);
		var att_string	= "";
		var opened 	= function(err, fd)
		{
			if(!err)
			{
				var read = function(err, bytes)
				{
					if(self.paused)
					{
						self.resume = function() { read(err, bytes); };
					}
					else if(self.stopped)
					{
						fs.close(fd);
					}
					else if(!err)
					{
						if(bytes == chunk)
						{
							att_string += buffer.toString("base64");
							fs.read(fd, buffer, 0, chunk, null, read);
						}
						else
						{
							att_string += buffer.slice(0, bytes).toString("base64");
							
							for (var start = 0; start < att_string.length; start += 76)
							{
								self.emit('data', att_string.substring(start, start + 76) + CRLF);
							}
							
							self.emit('data', CRLF); // important!
							fs.close(fd, next);
						}
					}
					else
					{
						fs.close(fd);
						self.emit('error', err);
					}
				};

				fs.read(fd, buffer, 0, chunk, null, read);
			}
			else
				self.emit('error', err);
		};

		fs.open(attachment.path, 'r+', opened);
	};

	var output_text = function(next)
	{
		var data = ["Content-Type:", self.message.content, CRLF, "Content-Transfer-Encoding: 7bit", CRLF];
		data = data.concat(["Content-Disposition: inline", CRLF, CRLF]);
		data = data.concat([self.message.text || "", CRLF, CRLF]);

		self.emit('data', data.join(""));
		next();
	};

	var output_data = function()
	{
		// are there attachments or alternatives?
		if(self.message.attachments.length || self.message.html)
		{
			self.emit('data', "MIME-Version: 1.0" + CRLF);
			output_process(output_mixed);
		}

		// otherwise, you only have a text message
		else
		{
			output_text(function() { self.emit('end') });
		}
	};

	var output_header = function()
	{
		var data = [];

		for(var header in self.message.header)
		{
			// do not output BCC in the headers...
			if(!/bcc/i.test(header))
				data = data.concat([header, ": ", self.message.header[header], CRLF]);
		}

		self.emit('data', data.join(''));
		output_process(output_data);
	};

	output_process(output_header);
	return;
};

MessageStream.prototype.pause = function()
{
	self.paused = true;
};

MessageStream.prototype.resume = function()
{
	self.paused = false;

	if(self.resume)
	{
		var resume	= self.resume;
		self.resume = null;
		resume();
	}
};

MessageStream.prototype.destroy = function()
{
	self.stopped = true;
};

MessageStream.prototype.destroySoon = function()
{
	self.stopped = true;
};

util.inherits(MessageStream, stream.Stream);

exports.Message = Message;
exports.create = function(headers) 
{
	return new Message(headers);
};
