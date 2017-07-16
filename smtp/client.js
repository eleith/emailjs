var smtp       = require('./smtp');
var smtpError    = require('./error');
var message      = require('./message');
var addressparser= require('addressparser');

var Client = function(server)
{
   this.smtp         = new smtp.SMTP(server);
   //this.smtp.debug(1);

   this.queue        = [];
   this.timer        = null;
   this.sending      = false;
   this.ready        = false;
};

Client.prototype = 
{
   _poll: function()
   {
      var self = this;

      clearTimeout(self.timer);

      if(self.queue.length)
      {
         if(self.smtp.state() == smtp.state.NOTCONNECTED)
            self._connect(self.queue[0]);

         else if(self.smtp.state() == smtp.state.CONNECTED && !self.sending && self.ready)
            self._sendmail(self.queue.shift());
      }
      // wait around 1 seconds in case something does come in, otherwise close out SMTP connection if still open
      else if(self.smtp.state() == smtp.state.CONNECTED)
         self.timer = setTimeout(function() { self.smtp.quit(); }, 1000);
   },

   _connect: function(stack)
   {
      var self = this,

      connect = function(err)
      {
         if(!err)
         {
            var begin = function(err)
            {
               if(!err)
               {
                  self.ready = true;
                  self._poll();
               }
               else {
                  stack.callback(err, stack.message);

                  // clear out the queue so all callbacks can be called with the same error message
                  self.queue.shift();
                  self._poll();
               }
            };

            if(!self.smtp.authorized())
               self.smtp.login(begin);

            else
               self.smtp.ehlo_or_helo_if_needed(begin);
         }
         else {
            stack.callback(err, stack.message);

            // clear out the queue so all callbacks can be called with the same error message
            self.queue.shift();
            self._poll();
         }
      };

      self.ready = false;
      self.smtp.connect(connect);
   },

   send: function(msg, callback)
   {
      var self = this;

      if(!(msg instanceof message.Message) 
          && msg.from 
          && (msg.to || msg.cc || msg.bcc)
          && (msg.text !== undefined || this._containsInlinedHtml(msg.attachment)))
         msg = message.create(msg);

      if(msg instanceof message.Message)
      {
         msg.valid(function(valid, why)
         {
            if(valid)
            {
               var stack = 
               {
                  message:    msg,
                  to:         addressparser(msg.header.to),
                  from:       addressparser(msg.header.from)[0].address,
                  callback:   callback || function() {}
               };

               if(msg.header.cc)
                  stack.to = stack.to.concat(addressparser(msg.header.cc));

               if(msg.header.bcc)
                  stack.to = stack.to.concat(addressparser(msg.header.bcc));

               if(msg.header['return-path'] && addressparser(msg.header['return-path']).length)
                 stack.returnPath = addressparser(msg.header['return-path'])[0].address;

               self.queue.push(stack);
               self._poll();
            }
            else
               callback(new Error(why), msg);
         });
      }
      else
         callback(new Error("message is not a valid Message instance"), msg);
   },

   _containsInlinedHtml: function(attachment) {
	   if (Array.isArray(attachment)) {
		   return attachment.some((function(ctx) {
			   return function(att) {
				   return ctx._isAttachmentInlinedHtml(att);
			   };
		   })(this));
	   } else {
		   return this._isAttachmentInlinedHtml(attachment);
	   }   
	},

   _isAttachmentInlinedHtml: function(attachment) {
	   return attachment && 
		  (attachment.data || attachment.path) && 
		   attachment.alternative === true;
   },

   _sendsmtp: function(stack, next)
   {
      var self   = this;
      var check= function(err)
      {
         if(!err && next)
         {
            next.apply(self, [stack]);
         }
         else
         {
            // if we snag on SMTP commands, call done, passing the error
            // but first reset SMTP state so queue can continue polling
            self.smtp.rset(function() { self._senddone(err, stack); });
         }
      };

      return check;
   },

   _sendmail: function(stack)
   {
      var self = this;
      var from = stack.returnPath || stack.from;
      self.sending = true;
      self.smtp.mail(self._sendsmtp(stack, self._sendrcpt), '<' + from + '>');
   },

   _sendrcpt: function(stack)
   {
      var self = this, to = stack.to.shift().address;
      self.smtp.rcpt(self._sendsmtp(stack, stack.to.length ? self._sendrcpt : self._senddata), '<'+ to +'>');
   },

   _senddata: function(stack)
   {
      var self = this;
      self.smtp.data(self._sendsmtp(stack, self._sendmessage));
   },

   _sendmessage: function(stack)
   {
      var self = this, stream = stack.message.stream();

      stream.on('data', function(data) { self.smtp.message(data); });
      stream.on('end', function() { self.smtp.data_end(self._sendsmtp(stack, function() { self._senddone(null, stack) })); });

      // there is no way to cancel a message while in the DATA portion, so we have to close the socket to prevent
      // a bad email from going out
      stream.on('error', function(err) { self.smtp.close(); self._senddone(err, stack); });
   },

   _senddone: function(err, stack)
   {
      var self = this;
      self.sending = false;
      stack.callback(err, stack.message);
      self._poll();
   }
};

exports.Client = Client;

exports.connect = function(server)
{
   return new Client(server);
};
