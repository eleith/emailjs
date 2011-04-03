//var email	= require('emailjs');
var email	= require('./email');
var os		= require('os');

SMTP = 
{
	USER: 	'username',
	PASS: 	'password',
	HOST: 	"smtp.gmail.com",
	PORT:		null, // emailjs will use default SMTP port standards (587, 465, 25) where appropriate
	SSL:		false, // use ssl from begin to end on smtp connection, accepts object of (key, ca, certs) as well...
	TLS:		true	// use STARTTLS encrypting stream after initial smtp connection
};

MESSAGE =
{
	DOMAIN:	os.hostname(),
	FROM:		'username@gmail.com',
	TO:		'person1 <person1@example.com>, person2 <person2@example.com>, person3 <person2@example.com>',
	SUBJECT:	'testing emailjs',
	TEXT:		'i hope this works',
	HTML:		'<html><body>i <i>hope</i> <b>this</b> works</body></html>',
	ATTACH:	
	{
		PATH:	'/path/to/file.tar.gz',
		TYPE: 'application/x-compressed-tar',
		NAME:	'renamed.tar.gz'
	}
};


var server = email.server.connect({
	user:			SMTP.USER, 
	password:	SMTP.PASS, 
	host:			SMTP.HOST, 
	port:			SMTP.PORT, 
	tls:			SMTP.TLS,
	ssl:			SMTP.SSL,
	domain:		MESSAGE.DOMAIN});

var msg = email.message.create({text:MESSAGE.TEXT, from:MESSAGE.FROM, to:MESSAGE.TO, subject:MESSAGE.SUBJECT});

msg.attach_alternative(MESSAGE.HTML).attach(MESSAGE.ATTACH.PATH, MESSAGE.ATTACH.TYPE, MESSAGE.ATTACH.NAME);

server.send(msg, function(err, message) { console.log(err || message); });
