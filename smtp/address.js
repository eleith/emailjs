/*
 * Email address parsing code.
 * rewritten with python's (2.7) email/_parseaddr.py as the starting point
*/

var SPACE = ' ';
var EMPTYSTRING = '';
var COMMASPACE = ', ';

var quote = function(str)
{
	// Add quotes around a string.
	return str.replace(/\\\\/g, '\\\\').replace(/"/g, '\\"');
};

/*
 * To understand what this class does, it helps to have a copy of RFC 2822 in
 * front of you.
 */

var Address = function(field)
{
	/*
	 * Initialize a new instance.
	 * `field' is an unparsed address header field, containing
	 * one or more addresses.
	*/

	this.specials 	= '()<>@,:;.\"[]';
	this.pos 		= 0;
	this.LWS 		= ' \t';
	this.CR 			= '\r\n';
	this.FWS 		= this.LWS + this.CR;
	this.atomends 	= this.specials + this.LWS + this.CR;
	
	// Note that RFC 2822 now specifies `.' as obs-phrase, meaning that it
	// is obsolete syntax.  RFC 2822 requires that we recognize obsolete
	// syntax, so allow dots in phrases.
	
	this.phraseends 	= this.atomends.replace(/\./g, '');
	this.field 			= field || "";
	this.commentlist 	= [];
};

Address.prototype =
{
	gotonext: function()
	{
		//Parse up to the start of the next address.
		while(this.pos < this.field.length)
		{
			if((this.LWS + '\n\r').indexOf(this.field[this.pos]) != -1)
				this.pos++;

			else if(this.field[this.pos] == '(')
				this.commentlist.push(this.getcomment());

			else
				break;
		}
	},

	getlist: function()
	{
		// Parse all addresses. Returns a list containing all of the addresses
		var result = [], ad;

		while(this.pos < this.field.length)
		{
			ad = this.get();

			if(ad)
				result.push(ad);

			else
				result.push({label:'', address:''});
		}

		return result;
	},

	get: function()
	{
		// Parse the next address
		this.commentlist = [];
		this.gotonext();

		var oldpos = this.pos, oldcl = this.commentlist, plist = this.getphraselist(), returnlist = [], 
			addrspec, fieldlen, routeaddr;

		this.gotonext();

		if(this.pos >= this.field.length)
		{
			// Bad email address, no domain
			if(plist)
				returnlist = [{label:this.commentlist.join(SPACE), address:plist[0]}]; 
		}

		else if('.@'.indexOf(this.field[this.pos]) != -1)
		{
			// email address is just an addrspec
			// this isn't very efficient since we start over
			this.pos = oldpos;
			this.commentlist = oldcl;
			addrspec = this.getspec();
			returnlist = {label:this.commentlist.join(SPACE), address:addrspec};
		}

		else if(this.field[this.pos] == ':')
		{
			// address is a group
			returnlist = [];
			fieldlen = this.field.length;
			this.pos++;

			while(this.pos < this.field.length)
			{
				this.gotonext();

				if(this.pos < fieldlen && this.field[this.pos] == ';')
				{
					this.pos += 1;
					break;
				}

				returnlist = returnlist.push(this.get());
			}
		}

		else if(this.field[this.pos] == '<')
		{
			// Address is a prhase then a route addr
			routeaddr = this.getroute();

			if(this.commentlist.length)
				returnlist = {label:plist.join(SPACE) + ' (' + this.commentlist.join(SPACE) + ')', address:routeaddr};

			else
				returnlist = {label:plist.join(SPACE), address:routeaddr};
		}

		else
		{
			if(plist)
				returnlist = {label:this.commentlist.join(SPACE), address:plist[0]};

			else if(this.specials.indexOf(this.field[this.pos]) != -1)
				this.post++;
		}

		this.gotonext();

		if(this.pos < this.field.length && this.field[this.pos] == ',')
			this.pos++;

		return returnlist;
	},

	getroute: function()
	{
		// Parse a route address. this method skips all route stuff and returns addrspec
		if(this.field[this.pos] != '<')
			return '';

		var expectroute = false, adlist = '';

		this.pos++;
		this.gotonext();

		while(this.pos < this.field.length)
		{
			if(expectroute)
			{
				this.getdomain();
				expectroute = false;
			}
			else if(this.field[this.pos] == '>')
			{
				this.pos += 1;
				break;
			}
			else if(this.field[this.pos] == '@')
			{
				this.pos += 1;
				expectroute = true;
			}
			else if(this.field[this.pos] == ':')
			{
				this.pos++;
			}
			else
			{
				adlist = this.getspec();
				this.pos++;
				break;
			}

			this.gotonext();
		}

		return adlist;
	},

	getspec: function()
	{
		//parse an RFC 2822 addr-spec
		var aslist = [];

		this.gotonext();

		while(this.pos < this.field.length)
		{
			if(this.field[this.pos] == '.')
			{
				aslist.push('.');
				this.pos++;
			}

			else if(this.field[this.pos] == '"')
				aslist.push('"' + this.getquote() + '"');

			else if(this.atomends.indexOf(this.field[this.pos]) != -1)
				break;

			else
				aslist.push(this.getatom());

			this.gotonext();
		}

		if(this.pos >= this.field.length || this.field[this.pos] != '@')
			return aslist.join(EMPTYSTRING);

		aslist.push('@');
		this.pos++;
		this.gotonext();

		return aslist.join(EMPTYSTRING) + this.getdomain();
	},

	getdomain: function()
	{
		// get the complete domain name from an address
		var sdlist = [];

		while(this.pos < this.field.length)
		{
			if(this.LWS.indexOf(this.field[this.pos]) != -1)
				this.pos++;

			else if(this.field[this.pos] == '(')
				this.commentlist.push(this.getcomment());

			else if(this.field[this.pos] == '[')
				sdlist.push(this.getdomainliteral());

			else if(this.field[this.pos] == '.')
			{
				this.pos++;
				sdlist.push('.');
			}

			else if(this.atomends.indexOf(this.field[this.pos]) != -1)
				break;

			else
				sdlist.push(this.getatom());
		}

		return sdlist.join(EMPTYSTRING);
	},

	getdelimited: function(beginchar, endchars, allowcomments)
	{
		/* 
		 * Parse a header fragment delimited by special characters.
		 *
		 * `beginchar' is the start character for the fragment.
		 * If self is not looking at an instance of `beginchar' then
		 * getdelimited returns the empty string.
		 * 
		 * `endchars' is a sequence of allowable end-delimiting characters.
		 * Parsing stops when one of these is encountered.
		 * 
		 * If `allowcomments' is non-zero, embedded RFC 2822 comments are allowed
		 * within the parsed fragment.
		 */

		if(this.field[this.pos] != beginchar)
			return '';

		allowcomments = (allowcomments === false) ? false : true;
		var slist = [''], quote = false;
		this.pos++;

		while(this.pos < this.field.length)
		{
			if(quote)
			{
				slist.push(this.field[this.pos]);
				quote = false;
			}
			else if(endchars.indexOf(this.field[this.pos]) != -1)
			{
				this.pos++;
				break;
			}
			else if(allowcomments && this.field[this.pos] == '(')
			{
				slist.push(this.getcomment());
				continue;
			}

			else if(this.field[this.pos] == '\\')
				quote = true;

			else
				slist.push(this.field[this.pos]);

			this.pos++;

		}

		return slist.join(EMPTYSTRING);
	},

	getquote: function()
	{
		// get a quote-delimited fragment from self's field
		return this.getdelimited('"', '"\r', false);
	},

	getcomment: function()
	{
		// Get a parenthesis-delimited fragment from self's field.
		return this.getdelimited('(', ')\r', true);
	},

	getdomainliteral: function()
	{
		// parse an rfc 2822 domain literal
		return '[' + this.getdelimited('[', ']\r', false) + ']';
	},

	getatom: function(atomends)
	{
		/*
		 * Parse an RFC 2822 atom.
		 * 
		 * Optional atomends specifies a different set of end token delimiters
		 * (the default is to use this.atomends).  This is used e.g. in
		 * getphraselist() since phrase endings must not include the `.' (which
		 * is legal in phrases).
		 */

		var atomlist = [''];

		if(atomends === undefined)
			atomends = this.atomends;

		while(this.pos < this.field.length)
		{
			if(atomends.indexOf(this.field[this.pos]) != -1)
				break;

			else
				atomlist.push(this.field[this.pos]);

			this.pos++;
		}

		return atomlist.join(EMPTYSTRING);
	},

	getphraselist: function()
	{
		/*
		 * Parse a sequence of RFC 2822 phrases.
		 *
		 * A phrase is a sequence of words, which are in turn either RFC 2822
		 * atoms or quoted-strings.  Phrases are canonicalized by squeezing all
		 * runs of continuous whitespace into one space.
		 */

		var plist = [];

		while(this.pos < this.field.length)
		{
			if(this.FWS.indexOf(this.field[this.pos]) != -1)
				this.pos++;

			else if(this.field[this.pos] == '"')
				plist.push(this.getquote());

			else if(this.field[this.pos] == '(')
				this.commentlist.push(this.getcomment());

			else if(this.phraseends.indexOf(this.field[this.pos]) != -1)
				break;

			else
				plist.push(this.getatom(this.phraseends));
		}

		return plist;
	}
};

exports.Address = Address;
exports.parse = function(field)
{
	var addresses 	= (new Address(field)).getlist();

	return addresses.length ? addresses : [];
};
