//var email	= require('emailjs');
var email	= require('./email');
var os		= require('os');

SMTP = 
{
	USER: 	'',
	PASS: 	'',
	HOST: 	"smtp.gmail.com",
	SECURE: 	true,
	PORT:		465
};

MESSAGE =
{
	DOMAIN:	os.hostname(),
	FROM:		'',
	TO:		'',
	SUBJECT:	'testing emailjs',
	TEXT:		'i hope this works',
	HTML:		'i <i>hope</i> <b>this</b> works',
	ATTACH:	
	{
		PATH:	'/path/to/file.tar.gz',
		TYPE: 'application/x-compressed-tar',
		NAME:	'renamed.tar.gz'
	}
};


var server 		= email.server.connect({user:SMTP.USER, password:SMTP.PASS, host:SMTP.HOST, port:SMTP.PORT, domain:MESSAGE.DOMAIN, secure:SMTP.SECURE});
var msg 			= email.message.create(MESSAGE.TEXT, {from:MESSAGE.FROM, to:MESSAGE.TO, subject:MESSAGE.SUBJECT});

msg.attach_alternative(MESSAGE.HTML).attach(ATTACH.PATH, ATTACH.TYPE, ATTACH.NAME);

server.send(msg, function(err, message) { console.log(message); });
