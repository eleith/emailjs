/*
 * SMTP class written using python's (2.7) smtplib.py as a base
 */
var net           = require('net');
var crypto        = require('crypto');
var os            = require('os');
var tls           = require('tls');
var util          = require('util');
var events        = require('events');
var starttls      = require('./tls');

var SMTPResponse  = require('./response');
var SMTPError     = require('./error');

var SMTP_PORT     = 25;
var SMTP_SSL_PORT = 465;
var SMTP_TLS_PORT = 587;
var CRLF          = "\r\n";
var AUTH_METHODS  = {PLAIN:'PLAIN', CRAM_MD5:'CRAM-MD5', LOGIN:'LOGIN'};
var TIMEOUT       = 5000;
var DEBUG         = 0;

var log = function()
{
   if(DEBUG)
   {
      Array.prototype.slice.call(arguments).forEach(function(d) { console.log(d); });
   }
};

var quotedata = function(data)
{
   // Quote data for email.
   // Double leading '.', and change Unix newline '\\n', or Mac '\\r' into
   // Internet CRLF end-of-line.
   
   return data.replace(/(?:\r\n|\n|\r(?!\n))/g, CRLF).replace(/^\./gm, '..');
};

var caller = function(callback)
{
   if(typeof(callback) == 'function')
   {
      var args = Array.prototype.slice.call(arguments);
      args.shift();

      callback.apply(null, args);
   }
};

var SMTPState = 
{
   NOTCONNECTED: 0,
   CONNECTING: 1,
   CONNECTED: 2
};

var SMTP = function(options)
{
   events.EventEmitter.call(this);

   options        = options || {};

   this.sock      = null;
   this.timeout   = options.timeout || TIMEOUT;
   this.features  = null;
   this._state    = SMTPState.NOTCONNECTED;
   this._secure   = false;
   this.loggedin  = (options.user && options.password) ? false : true;
   this.domain    = options.domain || os.hostname();
   this.host      = options.host || 'localhost';
   this.port      = options.port || (options.ssl ? SMTP_SSL_PORT : options.tls ? SMTP_TLS_PORT : SMTP_PORT);
   this.ssl       = options.ssl || false;
   this.tls       = options.tls || false;
   this.monitor   = null;

   // keep these strings hidden when quicky debugging/logging
   this.user      = function() { return options.user; };
   this.password  = function() { return options.password; };
};

SMTP.prototype = 
{
   debug: function(level)
   {
      DEBUG = level;
   },
   
   state: function()
   {
      return this._state;
   },
   
   authorized: function()
   {
      return this.loggedin;
   },
   
   connect: function(callback, port, host, options)
   {
      options = options || {};
   
      var self     = this;
   
      self.host    = host || self.host;
      self.port    = port || self.port;
      self.ssl     = options.ssl || self.ssl;
   
      if(self._state != SMTPState.NOTCONNECTED)
         self.quit();

      var connected = function(err) 
      {
         if(!err) 
         {
            log("connected: " + self.host + ":" + self.port);

            if(self.ssl && !self.tls)
            {
               // if key/ca/cert was passed in, check if connection is authorized
               if(typeof(self.ssl) != 'boolean' && !self.sock.authorized)
               {
                  self.close(true);
                  caller(callback, SMTPError('could not establish an ssl connection', SMTPError.CONNECTIONAUTH, err));
               }
               else
                  self._secure = true;
            }
         }
         else
         {
            self.close(true);
            caller(callback, SMTPError("could not connect", SMTPError.COULDNOTCONNECT, err));
         }
      };
   
      var response = function(err, msg)
      {
         if(err)
         {
            caller(callback, err);
         }
         else if(msg.code == '220')
         {
            log(msg.data);
   
            // might happen first, so no need to wait on connected()
            self._state = SMTPState.CONNECTED;
            caller(callback, null, msg.data);
         }
         else
         {
            log("response (data): " + msg.data);
            self.quit();
            caller(callback, SMTPError("bad response on connection", SMTPError.BADRESPONSE, err, msg.data));
         }
      };

      self._state = SMTPState.CONNECTING;
      log("connecting: " + self.host + ":" + self.port);
   
      if(self.ssl)
      {
         self.sock = tls.connect(self.port, self.host, self.ssl, connected);
      }
      else
      {
         self.sock = new net.Socket();
         self.sock.connect(self.port, self.host, connected);
      }

      self.monitor = SMTPResponse.monitor(self.sock, self.timeout, function() { self.close(true); });
      self.sock.once('response', response);
   },

   send: function(str, callback)
   {
      var self      = this;
   
      if(self.sock && self._state == SMTPState.CONNECTED)
      {
         log(str);

         var response = function(err, msg)
         {
            if(err)
            {
               caller(callback, err);
            }
            else
            {
               log(msg.data);
               caller(callback, null, msg);
            }
         };
   
         self.sock.once('response', response);
         self.sock.write(str);
      }
      else
      {
         self.close(true);
         caller(callback, SMTPError('no connection has been established', SMTPError.NOCONNECTION));
      }
   },
   
   command: function(cmd, callback, codes, failed)
   {
      codes = Array.isArray(codes) ? codes : typeof(codes) == 'number' ? [codes] : [250];
   
      var response = function(err, msg)
      {
         if(err)
         {
            caller(callback, err);
         }
         else
         {
            if(codes.indexOf(Number(msg.code)) != -1)
               caller(callback, err, msg.data, msg.message);

            else
               caller(callback, SMTPError("bad response on command '" + cmd.split(' ')[0] + "'", SMTPError.BADRESPONSE, null, msg.data));
         }
      };
   
      this.send(cmd + CRLF, response);
   },
   
   helo: function(callback, domain)
   {
      /*
       * SMTP 'helo' command.
       * Hostname to send for self command defaults to the FQDN of the local
       * host.
       */
   
      this.command("helo " + (domain || this.domain), callback);
   },
   
   starttls: function(callback)
   {
      var self = this,

      response = function(err, msg)
      {
         if(err)
         {
            err.message += " while establishing a starttls session";
            caller(callback, err);
         }
         else
         {
            var secured_socket   = null;
            var secured = function()
            {
               self._secure   = true;
               self.sock      = secured_socket;

               var error = function(err)
               {
                  self.close(true);
                  caller(callback, err);
               };

               SMTPResponse.monitor(self.sock, self.timeout, function() { self.close(true); });
               caller(callback, msg.data);
            };

            secured_socket = starttls.secure(self.sock, self.ssl, secured);
          }
      };

      this.command("starttls", response, [220]);
   },
   
   ehlo: function(callback, domain)
   {
      var self = this,
   
      response = function(err, data)
      {
         if(err)
         {
            caller(callback, err);
         }
         else
         {
            // According to RFC1869 some (badly written)
            //  MTA's will disconnect on an ehlo. Toss an exception if
            //  that happens -ddm
   
            data.split("\n").forEach(function(ext)
            {
               var parse = ext.match(/^(?:\d+[\-=]?)\s*?([^\s]+)(?:\s+(.*)\s*?)?$/);
   
               // To be able to communicate with as many SMTP servers as possible,
               // we have to take the old-style auth advertisement into account,
               // because:
               // 1) Else our SMTP feature parser gets confused.
               // 2) There are some servers that only advertise the auth methods we
               // support using the old style.
   
               if(parse)
               {
                  // RFC 1869 requires a space between ehlo keyword and parameters.
                  // It's actually stricter, in that only spaces are allowed between
                  // parameters, but were not going to check for that here.  Note
                  // that the space isn't present if there are no parameters.
                  self.features[parse[1].toLowerCase()] = parse[2] || true;
               }
            });

            if(self.tls && !self._secure)
               self.starttls(function() { self.ehlo(callback, domain); });

            else
               caller(callback, err, data);
          }
      };
   
      this.features = {};
      this.command("ehlo " + (domain || this.domain), response);
   },
   
   has_extn: function(opt)
   {
      return this.features[opt.toLowerCase()] === undefined;
   },
   
   help: function(callback, args)
   {
      // SMTP 'help' command, returns text from the server
      this.command(args ? "help " + args : "help", callback, [211, 214]);
   },
   
   rset: function(callback)
   {
      this.command("rset", callback);
   },
   
   noop: function(callback)
   {
      this.send("noop", callback);
   },
   
   mail: function(callback, from)
   {
      this.command("mail FROM:" + from, callback);
   },
   
   rcpt: function(callback, to)
   {
      this.command("RCPT TO:" + to, callback, [250, 251]);
   },
   
   data: function(callback)
   {
      this.command("data", callback, [354]);
   },

   data_end: function(callback)
   {
      this.command(CRLF + ".", callback);
   },

   message: function(data)
   {
      log(data);
      this.sock.write(data);
   },

   verify: function(address, callback)
   {
      // SMTP 'verify' command -- checks for address validity."""
      this.command("vrfy " + address, callback, [250, 251, 252]);
   },
   
   expn: function(address, callback)
   {
      // SMTP 'expn' command -- expands a mailing list.
      this.command("expn " + address, callback);
   },
   
   ehlo_or_helo_if_needed: function(callback, domain)
   {
      // Call self.ehlo() and/or self.helo() if needed.                                                                                                                           
      // If there has been no previous EHLO or HELO command self session, self
      //  method tries ESMTP EHLO first.
      var self = this;
   
      if(!this.features)
      {
         var response = function(err, data)
         {
            caller(callback, err, data);
         };
   
         var attempt = function(err)
         {
            if(err)
               self.helo(response, domain);
   
            else
               caller(callback, err);
         };
   
         self.ehlo(attempt, domain);
      }
   },
   
   login: function(callback, user, password, options)
   {
      var self = this,
      
      login = 
      {
         user:       user ? function() { return user; } : self.user,
         password:   password ? function() { return password; } : self.password,
         method:     options && options.method ? options.method.toUpperCase() : ''
      }, 
   
      domain = options && options.domain ? options.domain : this.domain,
   
      initiate = function(err, data)
      {
         if(err)
         {
            caller(callback, err);
            return;
         }
   
         /* 
          * Log in on an SMTP server that requires authentication.
          * 
          * The arguments are:
          *     - user:     The user name to authenticate with.
          *     - password: The password for the authentication.
          * 
          * If there has been no previous EHLO or HELO command self session, self
          * method tries ESMTP EHLO first.
          * 
          * This method will return normally if the authentication was successful.
          */
   
         var method = null,
         
         encode_cram_md5 = function(challenge)
         {
            challenge = (new Buffer(challenge, "base64")).toString("ascii");

            var hmac = crypto.createHmac('md5', login.password());
            hmac.update(challenge);

            return (new Buffer(login.user() + " " + hmac.digest('hex')).toString("base64"));
         },
   
         encode_plain = function()
         {
            return (new Buffer("\\0" + login.user() + "\\0" + login.password())).toString("base64");
         };
   
         // List of authentication methods we support: from preferred to
         // less preferred methods.
         if(!method)
         {
            var preferred = [AUTH_METHODS.CRAM_MD5, AUTH_METHODS.LOGIN, AUTH_METHODS.PLAIN];
   
            for(var i = 0; i < preferred.length; i++)
            {
               if((self.features.auth || "").indexOf(preferred[i]) != -1)
               {
                  method = preferred[i];
                  break;
               }
            }
         }

         // handle bad responses from command differently
         var failed = function(err, data)
         {
            self.loggedin = false;
            caller(callback, SMTPError('authorization.failed', SMTPError.AUTHFAILED, err, data));
         };
   
         var response = function(err, data)
         {
            if(err)
            {
               failed(err, data);
            }
            else
            {
               self.loggedin = true;
               caller(callback, err, data);
            }
         };
   
         var attempt = function(err, data, msg)
         {
            if(err)
            {
               failed(err, data);
            }
            else
            {
               if(method == AUTH_METHODS.CRAM_MD5)
                  self.command(encode_cram_md5(msg), response, [235, 503]);
   
               else if(method == AUTH_METHODS.LOGIN)
                  self.command((new Buffer(login.password())).toString("base64"), response, [235, 503]);
            }
         };

         var attempt_user = function(err, data, msg)
         {
            if(err)
            {
               failed(err, data);
            }
            else
            {
               if(method == AUTH_METHODS.LOGIN)
                  self.command((new Buffer(login.user())).toString("base64"), attempt, [334]);
            }
         };

         if(method == AUTH_METHODS.CRAM_MD5)
            self.command("AUTH " + AUTH_METHODS.CRAM_MD5, attempt, [334]);
   
         else if(method == AUTH_METHODS.LOGIN)
            self.command("AUTH " + AUTH_METHODS.LOGIN, attempt_user, [334]);
   
         else if(method == AUTH_METHODS.PLAIN)
            self.command("AUTH " + AUTH_METHODS.PLAIN + " " + encode_plain(login.user(), login.password()), response, [235, 503]);
   
         else if(!method)
            caller(callback, SMTPError('no form of authorization supported', SMTPError.AUTHNOTSUPPORTED, null, data));
      };
   
      self.ehlo_or_helo_if_needed(initiate, domain);
   },
   
   close: function(force)
   {
      if(this.sock)
      {
         if(force)
         {
            log("smtp connection destroyed!");
            this.sock.destroy();
         }
         else
         {
            log("smtp connection closed.");
            this.sock.end();
         }
      }

      if(this.monitor)
      {
         this.monitor.stop();
         this.monitor   = null;
      }

      this._state    = SMTPState.NOTCONNECTED;
      this._secure   = false;
      this.sock      = null;
      this.features  = null;
      this.loggedin  = !(this.user() && this.password());
   },
   
   quit: function(callback)
   {
      var self = this,
      response = function(err, data)
      {
         caller(callback, err, data);
         self.close();
      };

      this.command("quit", response, [221, 250]);
   }
};

for(var each in events.EventEmitter.prototype)
{
   SMTP.prototype[each] = events.EventEmitter.prototype[each];
}

exports.SMTP   = SMTP;
exports.state  = SMTPState;
