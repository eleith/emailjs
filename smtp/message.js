var stream     = require('stream');
var util       = require('util');
var fs         = require('fs');
var os         = require('os');
var path       = require('path');
var moment     = require('moment');
var mimelib    = require('mimelib');
var addressparser = require('addressparser'); 
var CRLF       = "\r\n";
var MIMECHUNK  = 76; // MIME standard wants 76 char chunks when sending out.
var BASE64CHUNK= 24; // BASE64 bits needed before padding is used
var MIME64CHUNK= MIMECHUNK * 6; // meets both base64 and mime divisibility
var BUFFERSIZE = MIMECHUNK*24*7; // size of the message stream buffer
var counter    = 0;

// support for nodejs without Buffer.concat native function
if(!Buffer.concat)
{
   require("bufferjs/concat");
}

var generate_boundary = function()
{
   var text       = "";
   var possible    = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'()+_,-./:=?";

   for(var i=0; i < 69; i++)
      text += possible.charAt(Math.floor(Math.random() * possible.length));

   return text;
};

function person2address(l) 
{
  var addresses = addressparser(l);
  return addresses.map(function(addr) {
    return addr.name ? mimelib.encodeMimeWord(addr.name, 'Q', 'utf-8').replace(/,/g, '=2C') + ' ' + '<' + addr.address + '>' : addr.address;
  }).join(', ');
}

var fix_header_name_case = function(header_name) {
    return header_name.toLowerCase().replace(/^(.)|-(.)/g, function(match) {
        return match.toUpperCase();
    });
};

var Message = function(headers)
{
   this.attachments  = [];
   this.alternative  = null;
   var now = new Date();
   this.header       = {
      "message-id":"<" + now.getTime() + "." + (counter++) + "." + process.pid + "@" + os.hostname() +">",
      "date":moment().format("ddd, DD MMM YYYY HH:mm:ss ") + moment().format("Z").replace(/:/, '')
   };
   this.content      = "text/plain; charset=utf-8";

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
      else if(header == "attachment" && typeof (headers[header]) == "object")
      {
         if(Array.isArray(headers[header])) {
            var that = this;

            for (var i = 0, l = headers[header].length; i < l; i++) {
              this.attach(headers[header][i]);
            }
         } else {
            this.attach(headers[header]);
         }
      }
      else if(header == 'subject')
      {
         this.header.subject = mimelib.encodeMimeWord(headers.subject, 'Q', 'utf-8');
      }
      else if(/^(cc|bcc|to|from)/i.test(header))
      {
         this.header[header.toLowerCase()] = person2address(headers[header]);
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
   attach: function(options)
   {
      /* 
         legacy support, will remove eventually... 
         arguments -> (path, type, name, headers)
      */
      if (arguments.length > 1)
        options = {path:options, type:arguments[1], name:arguments[2]};

      // sender can specify an attachment as an alternative
      if(options.alternative)
      {
         this.alternative           = options;
         this.alternative.charset   = options.charset || "utf-8";
         this.alternative.type      = options.type || "text/html";
         this.alternative.inline    = true;
      }
      else
         this.attachments.push(options);

      return this;
   },

   /* 
      legacy support, will remove eventually...
      should use Message.attach() instead
   */
   attach_alternative: function(html, charset)
   {
      this.alternative =
      {
         data:    html,
         charset: charset || "utf-8",
         type:    "text/html",
         inline:  true
      };

      return this;
   },

   valid: function(callback)
   {
      var self = this;

      if(!self.header.from)
      {
         callback(false, "message does not have a valid sender");
      }
      if(!(self.header.to || self.header.cc || self.header.bcc))
      {
         callback(false, "message does not have a valid recipient");
      }
      else if(self.attachments.length === 0)
      {
         callback(true);
      }
      else
      {
         var check  = [];
         var failed = [];

         self.attachments.forEach(function(attachment, index)
         {
            if(attachment.path)
            {
               // migrating path->fs for existsSync)
               if(!(fs.existsSync || path.existsSync)(attachment.path))
                  failed.push(attachment.path + " does not exist");
            }
            else if(attachment.stream)
            {
               if(!attachment.stream.readable)
                  failed.push("attachment stream is not readable");
            }
            else if(!attachment.data)
            {
               failed.push("attachment has no data associated with it");
            }
         });

         callback(failed.length === 0, failed.join(", "));
      }
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
   var self       = this;

   stream.Stream.call(self);

   self.message   = message;
   self.readable  = true;
   self.paused    = false;
   self.buffer    = new Buffer(MIMECHUNK*24*7);
   self.bufferIndex = 0;

   var output_process = function(next, args)
   {
      if(self.paused)
      {
         self.resumed = function() { next.apply(null, args); };
      }
      else
      {
         next.apply(null, args);
      }
   
      next.apply(null, args);
   };
   
   var output_mixed = function()
   {
      var boundary   = generate_boundary();
      var data       = ["Content-Type: multipart/mixed; boundary=\"", boundary, "\"", CRLF, CRLF, "--", boundary, CRLF];

      output(data.join(''));

      if(!self.message.alternative)
      {
         output_text(self.message);
         output_message(boundary, self.message.attachments, 0, close);
      }
      else
      {
         output_alternative(self.message, function() { output_message(boundary, self.message.attachments, 0, close); });
      }
   };

   var output_message = function(boundary, list, index, callback)
   {
      if(index < list.length)
      {
         output(["--", boundary, CRLF].join(''));

         if(list[index].related)
         {
            output_related(list[index], function() { output_message(boundary, list, index + 1, callback); });
         }
         else
         {
            output_attachment(list[index], function() { output_message(boundary, list, index + 1, callback); });
         }
      }
      else
      {
         output([CRLF, "--", boundary, "--", CRLF, CRLF].join(''));
         callback();
      }
   };

   var output_attachment_headers = function(attachment)
   {
      var data = [],
          header,
          headers = 
          {
            'content-type': attachment.type + 
              (attachment.charset ? "; charset=" + attachment.charset : "") + 
              (attachment.method ? "; method=" + attachment.method : ""),
            'content-transfer-encoding': 'base64', 
            'content-disposition': attachment.inline ? 'inline' : 'attachment; filename="' + mimelib.encodeMimeWord(attachment.name, 'Q', 'utf-8') + '"'
          };

      for(header in (attachment.headers || {}))
      {
         // allow sender to override default headers
         headers[header.toLowerCase()] = attachment.headers[header];
      }

      for(header in headers)
      {
         data = data.concat([fix_header_name_case(header), ': ', headers[header], CRLF]);
      }

      output(data.concat([CRLF]).join(''));
   };

   var output_attachment = function(attachment, callback)
   {
      var build = attachment.path ? output_file : attachment.stream ? output_stream : output_data;
      output_attachment_headers(attachment);
      build(attachment, callback);
   };

   var output_data = function(attachment, callback)
   {
      output_base64(attachment.encoded ? attachment.data : new Buffer(attachment.data).toString("base64"), callback);
   };

   var output_file = function(attachment, next)
   {
      var chunk      = MIME64CHUNK*16;
      var buffer     = new Buffer(chunk);
      var closed     = function(fd) { fs.close(fd); };
      var opened     = function(err, fd)
      {
         if(!err)
         {
            var read = function(err, bytes)
            {
               if(!err && self.readable)
               {
                  // guaranteed to be encoded without padding unless it is our last read
                  output_base64(buffer.toString("base64", 0, bytes), function()
                  {
                     if(bytes == chunk) // we read a full chunk, there might be more
                     {
                        fs.read(fd, buffer, 0, chunk, null, read);
                     }
                     else // that was the last chunk, we are done reading the file
                     {
                        self.removeListener("error", closed);
                        fs.close(fd, next);
                     }
                  });
               }
               else
               {
                  self.emit('error', err || {message:"message stream was interrupted somehow!"});
               }
            };

            fs.read(fd, buffer, 0, chunk, null, read);
            self.once("error", closed);
         }
         else
            self.emit('error', err);
      };

      fs.open(attachment.path, 'r', opened);
   };

   var output_stream = function(attachment, callback)
   {
      if(attachment.stream.readable)
      {
         var previous = null;

         attachment.stream.resume();
         attachment.stream.on('end', function()
         {
            output_base64((previous || new Buffer(0)).toString("base64"), callback);
            self.removeListener('pause', attachment.stream.pause);
            self.removeListener('resume', attachment.stream.resume);
            self.removeListener('error', attachment.stream.resume);
         });

         attachment.stream.on('data', function(buffer)
         {
            // do we have bytes from a previous stream data event?
            if(previous)
            {
               var buffer2 = Buffer.concat([previous, buffer]);
               previous    = null; // free up the buffer
               buffer      = null; // free up the buffer
               buffer      = buffer2;
            }

            var padded = buffer.length % (MIME64CHUNK);

            // encode as much of the buffer to base64 without empty bytes
            if(padded)
            {
               previous = new Buffer(padded);
               // copy dangling bytes into previous buffer
               buffer.copy(previous, 0, buffer.length - padded);
            }

            output_base64(buffer.toString("base64", 0, buffer.length - padded));
         });

         self.on('pause', attachment.stream.pause);
         self.on('resume', attachment.stream.resume);
         self.on('error', attachment.stream.resume);
      }
      else 
         self.emit('error', {message:"stream not readable"});
   };

   var output_base64 = function(data, callback)
   {
      var loops   = Math.ceil(data.length / MIMECHUNK);
      var loop    = 0;

      while(loop < loops)
      {
        output(data.substring(MIMECHUNK * loop, MIMECHUNK * (loop + 1)) + CRLF);
        loop++;
      }

      if(callback)
        callback();
   };

   var output_text = function(message)
   {
      var data = [];

      data = data.concat(["Content-Type:", message.content, CRLF, "Content-Transfer-Encoding: 7bit", CRLF]);
      data = data.concat(["Content-Disposition: inline", CRLF, CRLF]);
      data = data.concat([message.text || "", CRLF, CRLF]);

      output(data.join(''));
   };

   var output_alternative = function(message, callback)
   {
      var data = [], boundary = generate_boundary();

      data     = data.concat(["Content-Type: multipart/alternative; boundary=\"", boundary, "\"", CRLF, CRLF]);
      data     = data.concat(["--", boundary, CRLF]);

      output(data.join(''));
      output_text(message);
      output(["--", boundary, CRLF].join(''));

      var finish = function()
      {
         output([CRLF, "--", boundary, "--", CRLF, CRLF].join(''));
         callback();
      };

      if(message.alternative.related)
      {
         output_related(message.alternative, finish);
      }
      else
      {
         output_attachment(message.alternative, finish);
      }
   };

   var output_related = function(message, callback)
   {
      var data = [], boundary = generate_boundary();

      data     = data.concat(["Content-Type: multipart/related; boundary=\"", boundary, "\"", CRLF, CRLF]);
      data     = data.concat(["--", boundary, CRLF]);

      output(data.join(''));

      output_attachment(message, function()
      {
         output_message(boundary, message.related, 0, function()
         {
            output([CRLF, "--", boundary, "--", CRLF, CRLF].join(''));
            callback();
         });
      });
   };

   var output_header_data = function()
   {
      if(self.message.attachments.length || self.message.alternative)
      {
         output("MIME-Version: 1.0" + CRLF);
         output_mixed();
      }
      else // you only have a text message!
      {
         output_text(self.message);
         close();
      }
   };

   var output_header = function()
   {
      var data = [];

      for(var header in self.message.header)
      {
         // do not output BCC in the headers (regex) nor custom Object.prototype functions...
         if(!(/bcc/i.test(header)) && self.message.header.hasOwnProperty (header))
            data = data.concat([fix_header_name_case(header), ": ", self.message.header[header], CRLF]);
      }

      output(data.join(''));
      output_header_data();
   };

   var output = function(data, callback, args)
   {
      var bytes = Buffer.byteLength(data);

      // can we buffer the data?
      if(bytes + self.bufferIndex < self.buffer.length)
      {
         self.buffer.write(data, self.bufferIndex);
         self.bufferIndex += bytes;

         if(callback)
            callback.apply(null, args);
      }
      // we can't buffer the data, so ship it out!
      else if(bytes > self.buffer.length)
      {
         if(self.bufferIndex)
         {
            self.emit('data', self.buffer.toString("utf-8", 0, self.bufferIndex));
            self.bufferIndex = 0;
         }

         var loops   = Math.ceil(data.length / self.buffer.length);
         var loop    = 0;

         while(loop < loops)
         {
           self.emit('data', data.substring(self.buffer.length*loop, self.buffer.length*(loop + 1)));
           loop++;
         }
      }
      else // we need to clean out the buffer, it is getting full
      {
         if(!self.paused)
         {
            self.emit('data', self.buffer.toString("utf-8", 0, self.bufferIndex));
            self.buffer.write(data, 0);
            self.bufferIndex = bytes;

            // we could get paused after emitting data...
            if(self.paused)
            {
               self.once("resume", function() { callback.apply(null, args); });
            }
            else if(callback)
            {
               callback.apply(null, args);
            }
         }
         else // we can't empty out the buffer, so let's wait till we resume before adding to it
         {
            self.once("resume", function() { output(data, callback, args); });
         }
      }
   };

   var close = function(err)
   {
      if(err)
      {
         self.emit("error", err);
      }
      else
      {
         self.emit('data', self.buffer.toString("utf-8", 0, self.bufferIndex));
         self.emit('end');
      }

      self.buffer = null;
      self.bufferIndex = 0;
      self.readable = false;
      self.removeAllListeners("resume");
      self.removeAllListeners("pause");
      self.removeAllListeners("error");
      self.removeAllListeners("data");
      self.removeAllListeners("end");
   };

   self.once("destroy", close);
   process.nextTick(output_header);
};

util.inherits(MessageStream, stream.Stream);

MessageStream.prototype.pause = function()
{
   this.paused = true;
   this.emit('pause');
};

MessageStream.prototype.resume = function()
{
   this.paused = false;
   this.emit('resume');
};

MessageStream.prototype.destroy = function()
{
   this.emit("destroy", self.bufferIndex > 0 ? {message:"message stream destroyed"} : null);
};

MessageStream.prototype.destroySoon = function()
{
   this.emit("destroy");
};

exports.Message = Message;
exports.BUFFERSIZE = BUFFERSIZE;
exports.create = function(headers) 
{
   return new Message(headers);
};
