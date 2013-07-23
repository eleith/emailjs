describe("authorize plain", function()
{
   var simplesmtp = require("simplesmtp");
   var expect     = require("chai").expect;
   var fs         = require("fs");
   var os         = require("os");
   var path       = require('path');
   var email      = require('../email');
   var port       = 2526;
   var server     = null;
   var smtp       = null;

   var send = function(message, verify)
   {
      smtp.on("startData", function(envelope)
      {
         envelope.parser = new (require("mailparser").MailParser)({defaultCharset:"utf-8"});
         envelope.parser.on("end", function(mail)
         {
            verify(mail);
            smtp.removeListener("startData", arguments.callee);
         });
      });

      server.send(message, function(err) 
      {
         if(err)
            throw err;
      });
   }

   before(function(done)
   {
      smtp = simplesmtp.createServer({secureConnection:true,
                                      requireAuthentication:true,
                                      authMethods: ["PLAIN"]});

      smtp.listen(port, function()
      {
         smtp.on("data", function(envelope, chunk)
         {
            envelope.parser.write(chunk);
         });
         
         smtp.on("dataReady", function(envelope, callback)
         {
            envelope.parser.end();
            callback(null);
         });

         done();
      });
   });

   after(function(done)
   {
      smtp.end(done);
   });

   it("login", function(done)
   {
      server = email.server.connect({port:port, user:"piglet", password:"haycorns", ssl:true});

      var message =
      {
         subject: "this is a test TEXT message from emailjs",
         from:    "piglet@gmail.com",
         to:      "pooh@gmail.com",
         text:    "It is hard to be brave when you're only a Very Small Animal."
      };

      smtp.on("authorizeUser", function(envelope, username, password, callback)
      {
         smtp.removeListener("authorizeUser", arguments.callee);
         callback(null, username == "piglet" && password == "haycorns")
      });

      send(email.message.create(message), function(mail)
      {
         expect(mail.text).to.equal(message.text + "\n\n");
         expect(mail.headers.subject).to.equal(message.subject);
         expect(mail.headers.from).to.equal(message.from);
         expect(mail.headers.to).to.equal(message.to);
         done();
      });
   });
});
