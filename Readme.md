#v0.1.19

### emailjs

send emails, html and attachments from node.js to any smtp server

### Installing 

	npm install emailjs

# FEATURES
 - works with SSL and TLS smtp servers (ex: gmail)
 - supports smtp authentication (PLAIN, LOGIN, CRAMMD5)
 - emails are queued and the queue is sent asynchronously
 - supports sending html emails and emails with multiple attachments (MIME)
 - works with nodejs 3.8 and above

# REQUIRES
 - access to an SMTP Server (ex: gmail)

# EXAMPLE USAGE - text only emails

		var email 	= require("./path/to/emailjs/email");
		var server 	= email.server.connect({
			user:		"username", 
			password:"password", 
			host:		"smtp.gmail.com", 
			ssl:		true
		});

		// send the message and get a callback with an error or details of the message that was sent
		server.send({
			text:		"i hope this works", 
			from:		"you <username@gmail.com>", 
			to:		"someone <someone@gmail.com>, another <another@gmail.com>",
			cc:		"else <else@gmail.com>",
			subject:	"testing emailjs"
		}, function(err, message) { console.log(err || message); });

# EXAMPLE USAGE - html emails and attachments

		var email 	= require("./path/to/emailjs/email");
		var server 	= email.server.connect({
			user:		"username", 
			password:"password", 
			host:		"smtp.gmail.com", 
			ssl:		true
		});

		var headers	= {
			text:		"i hope this works", 
			from:		"you <username@gmail.com>", 
			to:		"someone <someone@gmail.com>, another <another@gmail.com>",
			cc:		"else <else@gmail.com>",
			subject:	"testing emailjs"
		};

		// create the message
		var message = email.message.create(headers);

		// attach an alternative html email for those with advanced email clients
		message.attach_alternative("<html>i <i>hope</i> this works!</html>");

		// attach attachments because you can!
		message.attach("path/to/file.zip", "application/zip", "renamed.zip");

		// send the message and get a callback with an error or details of the message that was sent
		server.send(message, function(err, message) { console.log(err || message); });

		// you can continue to send more messages with successive calls to 'server.send', 
		// they will be queued on the same smtp connection

		// or you can create a new server connection with 'email.server.connect' 
		// to asynchronously send individual emails instead of a queue

# API 

## email.server.connect(options)

	// options is an object with the following keys
	options =
	{
		user 		// username for logging into smtp 
		password // password for logging into smtp
		host		// smtp host
		port		// smtp port (if null a standard port number will be used)
		ssl		// boolean or object {key, ca, cert} (if exists, ssl connection will be made)
		tls		// boolean (if true, starttls will be initiated)
		timeout	// max number of milliseconds to wait for smtp responses (defaults to 5000)
		domain	// domain to greet smtp with (defaults to os.hostname)
	}
	
## email.server.send(message, callback)
	
	// message can be a smtp.Message (as returned by email.message.create)
	// or an object identical to the first argument accepted by email.message.create

	// callback will be executed with (err, message)
	// either when message is sent or an error has occurred

## email.message.create(headers)

	// headers is an object ('from' and 'to' are required)
	// returns a Message object

	// you can actually pass more message headers than listed, the below are just the
	// most common ones you would want to use

	headers =
	{
		text		// text of the email 
		from		// sender of the format (address or name <address> or "name" <address>)
		to			// recipients (same format as above), multiple recipients are separated by a comma
		cc			// carbon copied recipients (same format as above)
		bcc		// blind carbon copied recipients (same format as above)
		subject	// string subject of the email
	}

## Message.attach_alternative(html, charset)

	// should only be called once

	html // string representing the html version of the email message
	charset // defaults to utf-8 if not passed

## Message.attach(path, mime_type, name)

	// can be called multiple times, each creating a new
	// attachment on the email itself

	path 			// string to where the file is located
	mime_type	// string of the file mime type
	name			// name to give the file as perceived by the recipient
	
## Authors

eleith
