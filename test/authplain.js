describe("authorize plain", function() {
   var parser     = require('mailparser').simpleParser;
   var smtpServer = require("smtp-server").SMTPServer;
   var expect     = require("chai").expect;
   var fs         = require("fs");
   var os         = require("os");
   var path       = require('path');
   var email      = require('../email');
   var port       = 2526;
   var server     = null;
   var smtp       = null;

   var send = function(message, verify, done) {
      smtp.onData = function(stream, session, callback) {
        parser(stream).then(verify).then(done).catch(done);
        stream.on('end', callback);
      };

      server.send(message, function(err) { if (err) throw err; });
   }

   before(function(done) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // prevent CERT_HAS_EXPIRED errors

      smtp = new smtpServer({secure: true, authMethods: ["LOGIN"]});
      smtp.listen(port, function() {
        smtp.onAuth = function(auth, session, callback) {
  		  	if (auth.username == "pooh" && auth.password == "honey") {
            callback(null, {user: "pooh"});
          } else {
            return callback(new Error("invalid user / pass"));
          }
			  }

        server = email.server.connect({port:port, user:"pooh", password:"honey", ssl:true});
        done();
      });
   });

   after(function(done) {
      smtp.close(done);
   });

   it("login", function(done) {
      var message = {
        subject: "this is a test TEXT message from emailjs",
        from:    "piglet@gmail.com",
        to:      "pooh@gmail.com",
        text:    "It is hard to be brave when you're only a Very Small Animal."
      };

      send(email.message.create(message), function(mail) {
         expect(mail.text).to.equal(message.text + "\n\n\n");
         expect(mail.subject).to.equal(message.subject);
         expect(mail.from.text).to.equal(message.from);
         expect(mail.to.text).to.equal(message.to);
      }, done);
   });

});
