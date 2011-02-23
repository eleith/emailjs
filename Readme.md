#v0.1

###send emails from node.js to any smtp server

### Installing 

     npm install emailjs

# FEATURES
 - works with SSL smtp servers (ex: gmail)
 - works with smtp server authentication (PLAIN, LOGIN, CRAMMD5)
 - emails are queued and the queue is sent asynchronously
 - supports sending html emails and emails with multiple attachments
 - works with nodejs 3.8 and above

# REQUIRES
 - access to an SMTP Server (ex: gmail)

# USAGE - text only emails

      var email 	= require("./path/to/emailjs/email");
		var server 	= email.server.connect({user:yourUSER, password:yourPASS, host:"smtp.gmail.com", port:465, domain:yourDOMAIN, secure:true});

		// send the message and get a callback with an error or details of the message that was sent
		server.send({text:"i hope this works", from:yourUSER + "@gmail.com", to:yourFRIEND, subject:"testing emailjs"}, function(err, message) { console.log(err || message); });

# USAGE - html emails and attachments

      var email 	= require("./path/to/emailjs/email");
		var server 	= email.server.connect({user:yourUSER, password:yourPASS, host:"smtp.gmail.com", port:465, domain:yourDOMAIN, secure:true});
		var message	= email.message.create("i hope this works", {from:yourUSER + "@gmail.com", to:yourFRIEND, subject:"testing emailjs"});

		// attach an alternative html email for those with advanced email clients
		message.attach_alternative("i <i>hope</i> this works!");

		// attach attachments because you can!
		message..attach("path/to/file.zip", "application/zip", "renamed.zip");

		// send the message and get a callback with an error or details of the message that was sent
		server.send(message, function(err, message) { console.log(err || message); });

		// you can continue to send more messages with successive calls to 'server.send', they will be queued on the same smtp connection
		// or you can create a new server connection with 'email.server.connect' to async send individual emails instead of a queue

## Authors

eleith
