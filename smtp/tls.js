var crypto 	= require('crypto');
var tls		= require('tls');

var secure = function(socket, options, cb)
{
	var sslcontext = crypto.createCredentials(options);
	//sslcontext.context.setCiphers('RC4-SHA:AES128-SHA:AES256-SHA');

	var pair = tls.createSecurePair(sslcontext, false);
	
	var cleartext = pipe(pair, socket);

	pair.on('secure', function() 
	{
		var verifyError = (pair.ssl || pair._ssl).verifyError();

		if(verifyError) 
		{
			cleartext.authorized = false;
			cleartext.authorizationError = verifyError;
		} 
		else 
		{
      	cleartext.authorized = true;
		}

		if (cb) cb();
	});

	cleartext._controlReleased = true;
	return cleartext;
};

var pipe = function(pair, socket) 
{
	pair.encrypted.pipe(socket);
	socket.pipe(pair.encrypted);

	var cleartext = pair.cleartext;
	cleartext.socket = socket;
	cleartext.encrypted = pair.encrypted;
	cleartext.authorized = false;

	function onerror(e) 
	{
		if (cleartext._controlReleased) 
		{
			cleartext.emit('error', e);
		}
	}

	function onclose() 
	{
		socket.removeListener('error', onerror);
		socket.removeListener('close', onclose);
	}

	socket.on('error', onerror);
	socket.on('close', onclose);

	return cleartext;
};

exports.secure = secure;
